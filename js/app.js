(function(){
"use strict";
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]; }); }
function trim0(x){ return String(Number(x).toFixed(4)).replace(/(\.\d*?)0+$/,"$1").replace(/\.$/,""); }
function fmtPrice(x){
if(x===null || x===undefined || isNaN(x)) return "-";
return Number(x).toFixed(2).replace(/\.?0+$/,"");
}
function fmtVol(x){ return Number(x||0).toLocaleString("zh-CN"); }
function fmtNum(x, d){ return Number(x||0).toFixed(d==null?2:d); }
function trunc1(x){ return Math.trunc(x*10)/10; }
function varietyKey(code){ return String(code).replace(/\d.*$/,"").toLowerCase(); }
function fmtNet1(x){
var t = trunc1(x);
if(x<0 && t===0){ return "-0"; }
if(t===Math.round(t)){ return String(t); }
return t.toFixed(1);
}
function feeAmount(c, price, kind, addPct){
var add = addPct||0;
var val = c[kind]||0;
if(c.feeType==="fixed"){ return val * (1 + add/100); }
return price * c.mult * val / 10000 * (1 + add/100);
}
function marginAmount(c, price, addPct){ return price * c.mult * (c.margin + (addPct||0)) / 100; }
function openCloseFee(c, price, addPct){ return feeAmount(c,price,"open",addPct) + feeAmount(c,price,"closeToday",addPct); }
function netPerTick(c, price, addPct){ return c.tickValue - openCloseFee(c,price,addPct); }
function feeCell(c, kind, addPct){
var v = c[kind]||0;
if(v===0){ return '<span class="fee-free" title="平今免费">免费</span>'; }
if(c.feeType==="fixed"){ return '<span class="fee-fixed">'+trim0(v)+"元</span>"; }
var amt = feeAmount(c, c.price, kind, addPct||0);
return '<span class="fee-amt" data-kind="'+kind+'">（'+fmtNum(amt,2)+'元）</span><span class="fee-rate">万分之'+trim0(v)+'</span>';
}
var state = {
exch: "all",
search: "",
quoteOk: null,
lastQuote: Date.now(),
userPriceEdited: false,
expanded: {},
calcCode: null,
globalMode: false,
gMarginAdd: 0, gFeeAdd: 0, gTicks: 10
};
function applyFeeOverride(c){
var key = varietyKey(c.code);
if(key==="au"){
var m = /(\d{2})$/.exec(c.code);
var isJunDec = m && (m[1]==="06" || m[1]==="12");
var fee20 = !!c.isMain || isJunDec;
c.feeType = "fixed";
c.open = fee20 ? 20 : 10;
c.closePrev = c.open;
c.closeToday = 0;
}
return c;
}
var contracts = CONTRACTS.map(function(c){ return applyFeeOverride(Object.assign({}, c)); });
var contractMap = {};
contracts.forEach(function(c){ contractMap[c.code.toLowerCase()] = c; });
var varietyMap = {};
CONTRACTS.forEach(function(c){
var key = varietyKey(c.code);
if(!varietyMap[key]){ varietyMap[key] = c; }
});
var allContracts = null;
var allMap = {};
var allByVariety = {};
var comboSource = [];
function lookup(code){ return contractMap[code] || allMap[code] || null; }
function fetchExchangeContracts(ex){
var perPage = 100;
function page(pn){
var url = "https://push2delay.eastmoney.com/api/qt/clist/get?pn="+pn+"&pz="+perPage+"&po=1&np=1&fltt=2&invt=2&fid=f5&fs=m:"+ex.market+"&fields=f12,f14,f2,f5";
return fetch(url, {cache:"no-store"}).then(function(r){ return r.json(); }).then(function(j){
if(!j || !j.data || !j.data.diff){ return {total:0, list:[]}; }
return {total:j.data.total, list:j.data.diff};
});
}
return page(1).then(function(first){
var tasks = [];
var pages = Math.ceil((first.total||0)/perPage);
for(var p=2;p<=pages;p++){ tasks.push(page(p)); }
return Promise.all(tasks).then(function(rest){
var diff = first.list.slice();
rest.forEach(function(r){ diff = diff.concat(r.list); });
return diff;
});
}).catch(function(){ return []; });
}
function fetchAllContracts(){
return Promise.all(EXCHANGES.map(fetchExchangeContracts)).then(function(arrays){
var raw = [];
arrays.forEach(function(a){ raw = raw.concat(a); });
return mapAllContracts(raw);
});
}
function mapAllContracts(raw){
var list = [];
var volByVariety = {};
raw.forEach(function(d){
var code = String(d.f12||"");
var name = String(d.f14||"");
if(!/\d/.test(code)) return;
if(/主连|次主连|连续|指数/.test(name)) return;
var key = varietyKey(code);
var base = varietyMap[key];
if(!base) return;
var c = Object.assign({}, base, {
code: code, name: name,
price: Number(d.f2) || base.price,
volume: Number(d.f5) || 0,
isMain: false, remark: ""
});
list.push(c);
if(!(key in volByVariety) || c.volume > volByVariety[key]){ volByVariety[key] = c.volume; }
});
list.forEach(function(c){
var key = varietyKey(c.code);
if(c.volume>0 && c.volume===volByVariety[key]){ c.isMain = true; c.remark = "主力"; }
applyFeeOverride(c);
});
return list;
}
function indexAll(list){
allContracts = list;
allMap = {}; allByVariety = {};
list.forEach(function(c){
allMap[c.code.toLowerCase()] = c;
var key = varietyKey(c.code);
(allByVariety[key] = allByVariety[key] || []).push(c);
});
Object.keys(allByVariety).forEach(function(k){
allByVariety[k].sort(function(a,b){ return (b.volume||0)-(a.volume||0); });
});
buildComboSource();
}
function prefetchAll(){
fetchAllContracts().then(function(list){
indexAll(list);
rebuildMainFromLive();
scheduleMainRefresh();
}).catch(function(){});
}
function rebuildMainFromLive(){
if(!allContracts) return;
var newList = [];
Object.keys(varietyMap).forEach(function(key){
var list = allByVariety[key]||[];
var live = list[0] || null;
var curCode = varietyMap[key].code.toLowerCase();
if(live && live.volume===0 && allMap[curCode]){ live = allMap[curCode]; }
if(!live || live.volume===0){ live = Object.assign({}, varietyMap[key]); }
var c = live ? Object.assign({}, live) : Object.assign({}, varietyMap[key]);
applyFeeOverride(c);
newList.push(c);
});
if(!newList.length) return;
var changed = newList.length!==contracts.length;
if(!changed){
for(var i=0;i<newList.length;i++){
if(newList[i].code!==contracts[i].code){ changed = true; break; }
}
}
if(!changed) return;
contracts = newList;
contractMap = {};
contracts.forEach(function(c){ contractMap[c.code.toLowerCase()] = c; });
if(state.calcCode && !contractMap[state.calcCode.toLowerCase()]){
state.calcCode = contracts[0] ? contracts[0].code : null;
}
renderTabs();
renderTables();
buildComboSource();
}
function scheduleMainRefresh(){
setTimeout(function(){
fetchAllContracts().then(function(list){
indexAll(list);
rebuildMainFromLive();
scheduleMainRefresh();
}).catch(scheduleMainRefresh);
}, 15*60*1000);
}
function matchSearch(c){
var q = state.search.trim().toLowerCase();
if(!q) return true;
return (c.name+" "+c.code).toLowerCase().indexOf(q) !== -1 ||
c.code.toLowerCase().indexOf(q) === 0;
}
function renderTabs(){
var box = $("exchTabs");
if(!box) return;
box.innerHTML = '<div class="tab'+(state.exch==="all"?" active":"")+'" data-exch="all">全部</div>' +
EXCHANGES.map(function(e){
var n = contracts.filter(function(c){ return c.exch===e.id; }).length;
return '<div class="tab'+(state.exch===e.id?" active":"")+'" data-exch="'+e.id+'">'+e.short+' ('+n+')</div>';
}).join("");
}
function getFiltered(){
return contracts.filter(function(c){
if(state.exch!=="all" && c.exch!==state.exch) return false;
return matchSearch(c);
});
}
function headCells(withExpand){
return (withExpand ? "<th>展开</th>" : "") +
"<th>合约名称</th><th>合约代码</th><th>现价</th><th>成交量↓</th>"+
"<th>买开保证金%</th><th>卖开保证金%</th><th>保证金/元</th>"+
"<th>开仓</th><th>平昨</th><th>平今</th><th>开+平/元</th>"+
"<th>每跳毛利</th><th>每跳净利</th><th>回报率%</th>"+(withExpand ? "" : "<th>备注</th>");
}
function rowHtml(c, withExpand){
var gm = state.globalMode ? (Number(state.gMarginAdd)||0) : 0;
var gf = state.globalMode ? (Number(state.gFeeAdd)||0) : 0;
var gt = state.globalMode ? (Math.max(1,Math.floor(Number(state.gTicks)||10))) : 10;
var feeOC = openCloseFee(c, c.price, gf);
var net = netPerTick(c, c.price, gf);
var netT = fmtNet1(net);
var netShow;
if(net<0){ netShow = '<span class="loss">'+netT+"</span>"; }
else if(net===0 || netT==="0"){ netShow = '<span class="zero">'+netT+"</span>"; }
else { netShow = '<span class="profit">'+netT+"</span>"; }
var key = varietyKey(c.code);
var badge = c.isMain ? '<span class="main-badge">主力</span>' : (c.remark==="次主力" ? '<span class="sub-badge">次主力</span>' : "");
var marginTxt = trim0(c.margin+gm)+"%";
var marginAmt = marginAmount(c, c.price, gm);
var roiShow = '<span class="muted">—</span>';
var roiMobile = "";
if(state.globalMode){
var gOpen = feeAmount(c, c.price, "open", gf);
var gToday = feeAmount(c, c.price, "closeToday", gf);
var gPrev = feeAmount(c, c.price, "closePrev", gf);
var gProfitT = c.tickValue * gt - gOpen - gToday;
var gProfitP = c.tickValue * gt - gOpen - gPrev;
var roiT = marginAmt>0 ? gProfitT/marginAmt*100 : 0;
var roiP = marginAmt>0 ? gProfitP/marginAmt*100 : 0;
roiShow = '<span class="roi-line '+(roiT<0?"loss":"profit")+'">平今 '+fmtNum(roiT,2)+"%</span>"+
'<span class="roi-line '+(roiP<0?"loss":"profit")+'">平昨 '+fmtNum(roiP,2)+"%</span>";
roiMobile = '<span class="roi-mobile '+(roiT<0?"loss":"profit")+'">回报率(平今) '+fmtNum(roiT,2)+"%</span>"+
'<span class="roi-mobile '+(roiP<0?"loss":"profit")+'">回报率(平昨) '+fmtNum(roiP,2)+"%</span>";
}
var toggleCell = withExpand
? '<td class="expand-cell"><span class="expand-btn" data-code="'+c.code+'" title="展开/收起该品种全部合约月份">'+(state.expanded[key]?"▾":"▸")+'</span></td>'
: "";
return "<tr class='cursor' data-code='"+c.code+"'>"+
toggleCell+
"<td class='cell-name' data-label='合约名称'>"+esc(c.name)+badge+roiMobile+"</td>"+
"<td data-label='代码'><b>"+esc(c.code)+"</b></td>"+
"<td data-label='现价' class='price-now'><span class='price-cell' data-code='"+c.code+"'>"+fmtPrice(c.price)+"</span></td>"+
"<td data-label='成交量' class='vol'><span class='vol-cell' data-code='"+c.code+"'>"+fmtVol(c.volume)+"</span></td>"+
"<td data-label='买开%'>"+marginTxt+"</td>"+
"<td data-label='卖开%'>"+marginTxt+"</td>"+
"<td data-label='保证金/元'><span class='margin-cell' data-code='"+c.code+"'>"+fmtNum(marginAmt,1)+"</span></td>"+
"<td data-label='开仓'>"+feeCell(c,"open",gf)+"</td>"+
"<td data-label='平昨'>"+feeCell(c,"closePrev",gf)+"</td>"+
"<td data-label='平今'>"+feeCell(c,"closeToday",gf)+"</td>"+
"<td data-label='开+平/元'><span class='oc-cell' data-code='"+c.code+"'>"+fmtNum(feeOC,2)+"</span></td>"+
"<td data-label='每跳毛利'><span class='profit'>"+c.tickValue.toFixed(1)+"</span></td>"+
"<td data-label='每跳净利'><span class='net-cell' data-code='"+c.code+"'>"+netShow+"</span></td>"+
"<td data-label='回报率%'>"+roiShow+"</td>"+
(withExpand ? "" : "<td data-label='备注'>"+esc(c.remark||"")+"</td>")+
"</tr>";
}
function expansionContent(key){
if(!allContracts){ return '<td colspan="15" class="empty-tip">正在加载全部合约…</td>'; }
var list = allByVariety[key] || [];
if(!list.length){ return '<td colspan="15" class="empty-tip">暂无可显示合约</td>'; }
return '<td colspan="15"><div class="collapse-bar"><button class="collapse-btn" data-key="'+key+'">▲ 收起该品种全部合约</button></div><div class="sub-wrap"><table class="sub-table"><thead><tr>'+headCells(false)+"</tr></thead><tbody>"+
list.map(function(c){ return rowHtml(c,false); }).join("")+
"</tbody></table></div></td>";
}
function ensureExpansionRow(tr, key){
var next = tr.nextElementSibling;
if(next && next.classList.contains("expand-row")) return;
var row = document.createElement("tr");
row.className = "expand-row";
row.innerHTML = expansionContent(key);
tr.after(row);
}
function renderTables(){
var main = $("main");
$("totalCount").textContent = contracts.length;
var filtered = getFiltered();
var blocks = [];
EXCHANGES.forEach(function(ex){
var list = filtered.filter(function(c){ return c.exch===ex.id; });
if(state.exch!=="all" && state.exch!==ex.id) return;
if(state.exch==="all" && list.length===0) return;
list.sort(function(a,b){ return (b.volume||0)-(a.volume||0); });
var head = '<div class="ex-title"><span>'+ex.name+'</span><span class="count">'+list.length+' 个品种 · 单位：手续费 元/手 或 万分之X · 保证金 %</span></div>';
var table = '<div class="table-wrap"><table class="main-table">'+
"<thead><tr>"+headCells(true)+"</tr></thead><tbody>"+
(list.length ? list.map(function(c){ return rowHtml(c,true); }).join("") : '<tr><td colspan="15" class="empty-tip">无匹配合约</td></tr>')+
"</tbody></table></div>";
blocks.push('<section class="exchange-block" data-exch="'+ex.id+'">'+head+table+"</section>");
});
main.innerHTML = blocks.join("") || '<div class="empty-tip">没有匹配的合约，换个关键词试试</div>';
document.querySelectorAll("tr[data-code]").forEach(function(tr){
if(tr.querySelector(".expand-btn")){
var key = varietyKey(tr.getAttribute("data-code"));
if(state.expanded[key]){ ensureExpansionRow(tr, key); }
}
});
}
function toggleVariety(code){
var key = varietyKey(code);
var tr = document.querySelector('tr[data-code="'+code+'"]');
if(!tr) return;
var next = tr.nextElementSibling;
if(next && next.classList.contains("expand-row")){
next.remove();
delete state.expanded[key];
var b = tr.querySelector(".expand-btn"); if(b) b.textContent = "▸";
} else {
state.expanded[key] = true;
var b2 = tr.querySelector(".expand-btn"); if(b2) b2.textContent = "▾";
ensureExpansionRow(tr, key);
}
}
var QUOTE_HOSTS = [
{url:"https://push2.eastmoney.com", label:"实时行情"},
{url:"https://push2delay.eastmoney.com", label:"延迟行情"}
];
var primaryFails = 0;
var primaryDisabledUntil = 0;
function buildSecids(){
var list = [], seen = {};
function add(c){
var ex = EXCHANGES.filter(function(e){ return e.id===c.exch; })[0];
if(!ex) return;
var s = ex.market+"."+c.code;
if(!seen[s]){ seen[s]=1; list.push(s); }
}
contracts.forEach(add);
Object.keys(state.expanded).forEach(function(key){
(allByVariety[key]||[]).forEach(add);
});
return list;
}
function fetchQuotes(){
var secids = buildSecids();
var chunks = [];
var chunkSize = 60;
for(var i=0;i<secids.length;i+=chunkSize){ chunks.push(secids.slice(i,i+chunkSize)); }
function tryHost(idx){
if(idx>=QUOTE_HOSTS.length){ return Promise.reject(new Error("all hosts failed")); }
if(idx===0 && Date.now()<primaryDisabledUntil){ return tryHost(1); }
var host = QUOTE_HOSTS[idx];
var controller = new AbortController();
var timer = setTimeout(function(){ controller.abort(); }, 20000);
return Promise.all(chunks.map(function(chunk){
var url = host.url + "/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f4,f5,f6,f12,f14&secids="+encodeURIComponent(chunk.join(","));
return fetch(url, {signal: controller.signal, cache:"no-store"}).then(function(r){ return r.json(); });
})).then(function(resArr){
clearTimeout(timer);
var arr = [];
resArr.forEach(function(res){
if(res && res.data && res.data.diff){ arr = arr.concat(res.data.diff); }
});
if(arr.length===0){
if(idx===0){ primaryFails++; if(primaryFails>=2){ primaryDisabledUntil = Date.now()+5*60*1000; primaryFails=0; } }
return tryHost(idx+1);
}
if(idx===0){ primaryFails=0; }
return {list: arr, source: host.label};
}).catch(function(){
clearTimeout(timer);
if(idx===0){ primaryFails++; if(primaryFails>=2){ primaryDisabledUntil = Date.now()+5*60*1000; primaryFails=0; } }
return tryHost(idx+1);
});
}
return tryHost(0);
}
function applyQuotes(res){
var arr = res && res.list ? res.list : (res && res.length!==undefined ? res : []);
if(res && res.source){ state.lastSource = res.source; }
var changed = [];
arr.forEach(function(d){
var code = (d.f12||"").toLowerCase();
var c = lookup(code);
if(!c) return;
var p = Number(d.f2);
if(!isNaN(p) && p>0){
if(Math.abs(p-c.price)>1e-9){ changed.push(code); }
c.price = p;
}
var v = Number(d.f5);
if(!isNaN(v)){ c.volume = v; }
});
changed.forEach(function(code){
var els = document.querySelectorAll("[data-code='"+code+"']");
els.forEach(function(el){ el.classList.remove("flash-price"); void el.offsetWidth; el.classList.add("flash-price"); });
});
var gm = state.globalMode ? (Number(state.gMarginAdd)||0) : 0;
var gf = state.globalMode ? (Number(state.gFeeAdd)||0) : 0;
document.querySelectorAll(".price-cell, .vol-cell, .margin-cell, .oc-cell, .net-cell").forEach(function(el){
var code = el.getAttribute("data-code").toLowerCase();
var c = lookup(code);
if(!c) return;
if(el.classList.contains("price-cell")){ el.textContent = fmtPrice(c.price); }
else if(el.classList.contains("vol-cell")){ el.textContent = fmtVol(c.volume); }
else if(el.classList.contains("margin-cell")){ el.textContent = fmtNum(marginAmount(c,c.price,gm),1); }
else if(el.classList.contains("oc-cell")){ el.textContent = fmtNum(openCloseFee(c,c.price,gf),2); }
else if(el.classList.contains("net-cell")){
var net = netPerTick(c,c.price,gf), netT = fmtNet1(net);
el.innerHTML = net<0 ? '<span class="loss">'+netT+"</span>"
: (net===0 || netT==="0") ? '<span class="zero">'+netT+"</span>"
: '<span class="profit">'+netT+"</span>";
}
});
document.querySelectorAll("tr[data-code]").forEach(function(tr){
var code = tr.getAttribute("data-code");
var c = lookup((code||"").toLowerCase());
if(!c) return;
tr.querySelectorAll(".fee-amt").forEach(function(el){
var k = el.getAttribute("data-kind");
el.textContent = "（"+fmtNum(feeAmount(c,c.price,k,gf),2)+"元）";
});
});
if(state.calcCode && !state.userPriceEdited){
var cc = lookup(state.calcCode.toLowerCase());
if(cc){
var prev = Number($("calcPrice").value);
if(prev!==cc.price){ $("calcPrice").value = cc.price; recalc(); }
}
}
refreshQuoteUI(true, state.lastSource);
}
function refreshQuoteUI(ok, source){
state.quoteOk = ok;
var dot = $("quoteDot"), st = $("quoteStatus");
if(ok){
dot.className = "dot ok";
st.textContent = (source||"实时行情") + "已连接";
$("quoteSyncTime").textContent = new Date().toLocaleString("zh-CN", {hour12:false});
} else {
dot.className = "dot err";
st.textContent = "行情未连接（显示本地缓存数据）";
}
}
function quoteLoop(){
fetchQuotes().then(function(res){
applyQuotes(res);
setTimeout(quoteLoop, 15000);
}).catch(function(){
refreshQuoteUI(false);
setTimeout(quoteLoop, 30000);
});
}
function buildComboSource(){
var seen = {}, src = [];
contracts.forEach(function(c){ if(!seen[c.code.toLowerCase()]){ seen[c.code.toLowerCase()]=1; src.push(c); } });
(allContracts||[]).forEach(function(c){ if(!seen[c.code.toLowerCase()]){ seen[c.code.toLowerCase()]=1; src.push(c); } });
src.sort(function(a,b){ return a.code.localeCompare(b.code); });
comboSource = src;
}
function initCombo(){
var input = $("calcContractInput");
var listEl = $("calcComboList");
input.addEventListener("focus", showCombo);
input.addEventListener("input", showCombo);
input.addEventListener("blur", function(){ setTimeout(closeCombo, 150); });
input.addEventListener("keydown", function(e){
if(e.key==="Enter"){
var first = listEl.querySelector(".combo-item");
if(first){ selectCombo(first.getAttribute("data-code")); e.preventDefault(); }
}
});
listEl.addEventListener("mousedown", function(e){ e.preventDefault(); });
listEl.addEventListener("click", function(e){
var it = e.target.closest(".combo-item");
if(it){ selectCombo(it.getAttribute("data-code")); }
});
}
function comboFilter(q){
q = (q||"").trim().toLowerCase();
if(!q) return comboSource.slice(0,60);
return comboSource.filter(function(c){
return (c.name+" "+c.code).toLowerCase().indexOf(q)!==-1 || c.code.toLowerCase().indexOf(q)===0;
}).slice(0,60);
}
function showCombo(){
var q = $("calcContractInput").value;
var list = comboFilter(q);
var listEl = $("calcComboList");
if(!list.length){ listEl.innerHTML = '<div class="combo-empty">无匹配合约</div>'; }
else {
listEl.innerHTML = list.map(function(c){
return '<div class="combo-item" data-code="'+esc(c.code)+'"><span class="cc">'+esc(c.code)+'</span><span class="cn">'+esc(c.name)+'</span></div>';
}).join("");
}
listEl.classList.add("show");
}
function closeCombo(){ var el=$("calcComboList"); if(el) el.classList.remove("show"); }
function selectCombo(code){
var c = lookup(code.toLowerCase());
if(!c) return;
state.calcCode = c.code;
$("calcContractInput").value = c.name+" ("+c.code+")";
$("calcPrice").value = c.price;
state.userPriceEdited = false;
closeCombo();
recalc();
}
function selectContract(code){
var c = lookup(code.toLowerCase());
if(!c) return;
state.calcCode = c.code;
$("calcContractInput").value = c.name+" ("+c.code+")";
$("calcPrice").value = c.price;
state.userPriceEdited = false;
recalc();
document.querySelectorAll("tbody tr").forEach(function(tr){
tr.classList.toggle("selected", tr.getAttribute("data-code")===code);
});
expandCalc(true);
$("calcSection").scrollIntoView({behavior:"smooth", block:"start"});
}
function recalc(){
var c = state.calcCode ? lookup(state.calcCode.toLowerCase()) : contracts[0];
if(!c) return;
var price = Number($("calcPrice").value);
if(isNaN(price) || price<=0){ price = c.price; $("calcPrice").value = c.price; }
var lots = Math.max(1, Math.floor(Number($("calcLots").value)||1));
var ticks = Math.max(1, Math.floor(Number($("calcTicks").value)||10));
var marginAdd = Number($("calcMarginAdd").value)||0;
var feeAdd = Number($("calcFeeAdd").value)||0;
var mPer = marginAmount(c, price, marginAdd);
var openF = feeAmount(c, price, "open", feeAdd);
var prevF = feeAmount(c, price, "closePrev", feeAdd);
var todayF = feeAmount(c, price, "closeToday", feeAdd);
var ocPer = openF + todayF;
var net = c.tickValue - ocPer;
var ticksProfit = c.tickValue * ticks;
var netToday = ticksProfit - openF - todayF;
var netPrev = ticksProfit - openF - prevF;
var roiToday = mPer>0 ? netToday/mPer*100 : 0;
var roiPrev = mPer>0 ? netPrev/mPer*100 : 0;
var items = [
{k:"每手保证金", v:fmtNum(mPer,0), unit:"元", cls:""},
{k:"总保证金（"+lots+"手）", v:fmtNum(mPer*lots,0), unit:"元", cls:""},
{k:"开仓费/手", v:fmtNum(openF,2), unit:"元", cls:""},
{k:"平昨费/手", v:fmtNum(prevF,2), unit:"元", cls:""},
{k:"平今费/手", v:fmtNum(todayF,2), unit:"元", cls:""},
{k:"开+平/手", v:fmtNum(ocPer,2), unit:"元", cls:""},
{k:"开+平总费用（"+lots+"手）", v:fmtNum(ocPer*lots,2), unit:"元", cls:""},
{k:"每跳毛利", v:c.tickValue.toFixed(1), unit:"元", cls:"up"},
{k:"每跳净利", v:fmtNum(net,2), unit:"元", cls: net<0?"loss":"profit"},
{k:"吃"+ticks+"跳·毛利", v:fmtNum(ticksProfit,1), unit:"元", cls:"up"},
{k:"回报率·平今优惠", v:fmtNum(roiToday,2), unit:"%", cls: roiToday<0?"loss":"profit"},
{k:"回报率·平昨不优惠", v:fmtNum(roiPrev,2), unit:"%", cls: roiPrev<0?"loss":"profit"}
];
$("calcResults").innerHTML = items.map(function(x){
return '<div class="rrow"><span class="rk">'+x.k+'</span><span class="rv '+(x.cls||"")+'">'+x.v+'<span class="unit">'+x.unit+"</span></span></div>";
}).join("");
var feeStd = c.feeType==="fixed"
? "开仓 "+trim0(c.open)+"元/手 · 平昨 "+trim0(c.closePrev)+"元/手 · 平今 "+trim0(c.closeToday)+"元/手"
: "开仓 万分之"+trim0(c.open)+" · 平昨 万分之"+trim0(c.closePrev)+" · 平今 万分之"+trim0(c.closeToday);
if(state.globalMode){
state.gMarginAdd = Number($("calcMarginAdd").value)||0;
state.gFeeAdd = Number($("calcFeeAdd").value)||0;
state.gTicks = Math.max(1, Math.floor(Number($("calcTicks").value)||10));
renderTables();
}
$("calcInfo").textContent = "合约乘数："+c.mult+" · 交易所标准保证金："+trim0(c.margin)+"% · 手续费标准："+feeStd+
" · 每跳盈亏："+c.tickValue+"元"+(marginAdd||feeAdd ? "（已含加收：保证金+"+trim0(marginAdd)+"%，手续费+"+trim0(feeAdd)+"%）" : "");
}
function exportExcel(mode){
var list;
if(mode==="all"){
if(!allContracts){
var btn = $("btnExcel");
btn.textContent = "⏳ 正在加载全部合约…";
fetchAllContracts().then(function(l){
indexAll(l);
btn.textContent = "⬇ 下载 Excel ▾";
exportExcel("all");
}).catch(function(){
btn.textContent = "⬇ 下载 Excel ▾";
alert("加载全部合约失败，请稍后重试");
});
return;
}
list = allContracts.slice();
} else {
var seen = {};
list = contracts.slice();
list.forEach(function(c){ seen[c.code.toLowerCase()]=1; });
Object.keys(state.expanded).forEach(function(k){
(allByVariety[k]||[]).forEach(function(c){
if(!seen[c.code.toLowerCase()]){ seen[c.code.toLowerCase()]=1; list.push(c); }
});
});
}
var gm = state.globalMode ? (Number(state.gMarginAdd)||0) : 0;
var gf = state.globalMode ? (Number(state.gFeeAdd)||0) : 0;
var gt = state.globalMode ? (Math.max(1,Math.floor(Number(state.gTicks)||10))) : 10;
var rows = [];
rows.push(["国内期货手续费·保证金一览表（数据仅供参考，不构成投资建议）"]);
rows.push(["期货开户优惠：手续费可降至交易所标准附近 ｜ 微信：qhcg66 ｜ 网址：https://qhcg66.github.io/shouxufei/"]);
rows.push([]);
rows.push(["交易所","合约名称","合约代码","现价","成交量","保证金/元","买开保证金%","卖开保证金%","开仓手续费","平昨手续费","平今手续费","开+平/元","每跳毛利","每跳净利","回报率(平今)%","回报率(平昨)%","备注"]);
list.forEach(function(c){
var ex = EXCHANGES.filter(function(e){ return e.id===c.exch; })[0];
var marginAmt = marginAmount(c, c.price, gm);
var openF = feeAmount(c, c.price, "open", gf);
var todayF = feeAmount(c, c.price, "closeToday", gf);
var prevF = feeAmount(c, c.price, "closePrev", gf);
var roiToday = marginAmt>0 ? (c.tickValue*gt - openF - todayF)/marginAmt*100 : 0;
var roiPrev = marginAmt>0 ? (c.tickValue*gt - openF - prevF)/marginAmt*100 : 0;
rows.push([
ex.name, c.name, c.code, c.price, c.volume, fmtNum(marginAmt,1), trim0(c.margin+gm)+"%", trim0(c.margin+gm)+"%",
feeText(c,"open",gf), feeText(c,"closePrev",gf), feeText(c,"closeToday",gf),
fmtNum(openCloseFee(c,c.price,gf),2), c.tickValue, trunc1(netPerTick(c,c.price,gf)),
fmtNum(roiToday,2)+"%", fmtNum(roiPrev,2)+"%", c.remark||""
]);
});
var csv = "\uFEFF" + rows.map(function(r){
return r.map(function(v){ v=String(v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }).join(",");
}).join("\r\n");
var blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
var a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = (mode==="all"?"全部合约":"期货手续费保证金")+"一览表_"+new Date().toISOString().slice(0,10)+".csv";
document.body.appendChild(a); a.click();
setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 100);
}
function feeText(c, kind, addPct){
var v = c[kind]||0;
return c.feeType==="fixed" ? trim0(v)+"元" : fmtNum(feeAmount(c,c.price,kind,addPct||0),2)+"元（万分之"+trim0(v)+"）";
}
function fallbackCopy(text){
var ta = document.createElement("textarea");
ta.value = text; ta.style.position="fixed"; ta.style.opacity="0";
document.body.appendChild(ta); ta.select();
try{ document.execCommand("copy"); }catch(e){}
ta.remove();
}
/* 手机端：点击品种弹出详情（含被隐藏的列） */
function showDetail(code){
var c = lookup(String(code).toLowerCase());
if(!c) return;
var ex = EXCHANGES.filter(function(e){ return e.id===c.exch; })[0];
$("dtName").textContent = c.name;
var net = netPerTick(c, c.price, 0), netT = fmtNet1(net);
var netShow = net<0 ? '<span class="loss">'+netT+"</span>"
: (net===0 || netT==="0") ? '<span class="zero">'+netT+"</span>"
: '<span class="profit">'+netT+"</span>";
var row = function(k, v){ return '<div class="drow"><span class="dk">'+k+'</span><span class="dv">'+v+'</span></div>'; };
var html = "";
html += row("代码", "<b>"+esc(c.code)+"</b>");
html += row("交易所", esc(ex ? ex.name : c.exch));
html += row("现价", '<span class="price-cell" data-code="'+c.code+'">'+fmtPrice(c.price)+"</span>");
html += row("成交量", '<span class="vol-cell" data-code="'+c.code+'">'+fmtVol(c.volume)+"</span>");
html += row("保证金比例", trim0(c.margin)+"%");
html += row("保证金/元", '<span class="margin-cell" data-code="'+c.code+'">'+fmtNum(marginAmount(c,c.price,0),1)+"</span>");
html += row("开仓手续费", feeText(c,"open"));
html += row("平昨手续费", feeText(c,"closePrev"));
html += row("平今手续费", feeText(c,"closeToday"));
html += row("开+平/元", '<span class="oc-cell" data-code="'+c.code+'">'+fmtNum(openCloseFee(c,c.price,0),2)+"</span>");
html += row("每跳毛利", c.tickValue.toFixed(1)+" 元");
html += row("每跳净利", '<span class="net-cell" data-code="'+c.code+'">'+netShow+"</span>");
html += row("备注", esc(c.remark||""));
$("dtBody").innerHTML = html;
state.detailCode = c.code;
$("detailModal").classList.add("show");
}
/* 计算器展开/收起 */
function expandCalc(open){
var sec = $("calcSection");
if(!sec) return;
var want = (open===undefined) ? !sec.classList.contains("open") : open;
sec.classList.toggle("open", want);
var ar = $("calcArrow");
if(ar) ar.textContent = want ? "▾" : "▸";
}
/* ---------- 事件绑定 ---------- */
function bind(){
renderTabs();
renderTables();
initCombo();
buildComboSource();
$("feeSyncTime").textContent = META.feeSyncTime;
$("quoteSyncTime").textContent = META.quoteSyncTime;
/* 行点击：展开按钮 ↔ 计算器选择 */
$("main").addEventListener("click", function(e){
var cb = e.target.closest(".collapse-btn");
if(cb){
var ckey = cb.getAttribute("data-key");
var ctr = null;
document.querySelectorAll(".main-table tbody tr[data-code]").forEach(function(t){
if(!ctr && t.querySelector(".expand-btn") && varietyKey(t.getAttribute("data-code"))===ckey){ ctr = t; }
});
if(ctr){ toggleVariety(ctr.getAttribute("data-code")); }
return;
}
var btn = e.target.closest(".expand-btn");
if(btn){ toggleVariety(btn.getAttribute("data-code")); return; }
var tr = e.target.closest("tr[data-code]");
if(!tr) return;
if(window.innerWidth <= 760){ showDetail(tr.getAttribute("data-code")); }
else { selectContract(tr.getAttribute("data-code")); }
});
var calcHead = $("calcHead");
if(calcHead){ calcHead.addEventListener("click", function(){ expandCalc(); }); }
var calcAll = $("calcAllVarieties");
if(calcAll){ calcAll.addEventListener("change", function(){
state.globalMode = calcAll.checked;
state.gMarginAdd = Number($("calcMarginAdd").value)||0;
state.gFeeAdd = Number($("calcFeeAdd").value)||0;
state.gTicks = Math.max(1, Math.floor(Number($("calcTicks").value)||10));
renderTables();
}); }
var calcClear = $("calcClear");
if(calcClear){ calcClear.addEventListener("click", function(){
$("calcContractInput").value = "";
state.calcCode = null;
closeCombo();
$("calcResults").innerHTML = "<div class='empty-tip'>请选择或输入合约后自动计算</div>";
$("calcInfo").textContent = "";
$("calcContractInput").focus();
}); }
var dtCalc = $("dtCalc");
if(dtCalc){ dtCalc.addEventListener("click", function(){
if(state.detailCode){ selectContract(state.detailCode); }
$("detailModal").classList.remove("show");
}); }
var dtExpand = $("dtExpand");
if(dtExpand){ dtExpand.addEventListener("click", function(){
if(!state.detailCode) return;
$("detailModal").classList.remove("show");
var key = varietyKey(state.detailCode);
var mainTr = null;
document.querySelectorAll(".main-table tbody tr[data-code]").forEach(function(tr){
if(!mainTr && tr.querySelector(".expand-btn") && varietyKey(tr.getAttribute("data-code"))===key){ mainTr = tr; }
});
if(mainTr){
var next = mainTr.nextElementSibling;
if(!(next && next.classList.contains("expand-row"))){
toggleVariety(mainTr.getAttribute("data-code"));
}
mainTr.scrollIntoView({behavior:"smooth", block:"center"});
}
}); }
$("exchTabs").addEventListener("click", function(e){
var t = e.target.closest(".tab");
if(!t) return;
state.exch = t.getAttribute("data-exch");
renderTabs(); renderTables();
});
$("searchInput").addEventListener("input", function(){ state.search = this.value; renderTables(); });
$("btnRefresh").addEventListener("click", function(){
var b = this; b.disabled = true; b.textContent = "刷新中…";
fetchQuotes().then(function(res){
applyQuotes(res); refreshQuoteUI(true, res.source);
b.disabled=false; b.textContent="🔄 刷新行情";
}).catch(function(){
refreshQuoteUI(false);
b.disabled=false; b.textContent="🔄 刷新行情";
});
});
$("btnExcel").addEventListener("click", function(e){
e.stopPropagation();
$("excelMenu").classList.toggle("show");
});
document.addEventListener("click", function(){ var m=$("excelMenu"); if(m) m.classList.remove("show"); });
$("excelMenu").addEventListener("click", function(e){
var it = e.target.closest(".drop-item");
if(!it) return;
exportExcel(it.getAttribute("data-mode"));
this.classList.remove("show");
});
$("btnCalcMethod").addEventListener("click", function(){ $("feeModal").classList.add("show"); });
document.querySelectorAll("[data-close]").forEach(function(el){
el.addEventListener("click", function(){ $(el.getAttribute("data-close")).classList.remove("show"); });
});
$("feeModal").addEventListener("click", function(e){ if(e.target===this) this.classList.remove("show"); });
/* 开户广告 */
var adOpeners = ["btnFloatAd","btnOpenAd"];
adOpeners.forEach(function(id){
var el = $(id);
if(el){ el.addEventListener("click", function(){ $("adModal").classList.add("show"); }); }
});
document.querySelectorAll("[data-copy-wechat]").forEach(function(btn){
btn.addEventListener("click", function(){
var w = btn.getAttribute("data-copy-wechat") || "";
var orig = btn.textContent;
var done = function(){ btn.textContent = "已复制 ✓"; setTimeout(function(){ btn.textContent = orig; }, 2000); };
if(navigator.clipboard && navigator.clipboard.writeText){
navigator.clipboard.writeText(w).then(done, function(){ fallbackCopy(w); done(); });
} else { fallbackCopy(w); done(); }
});
});
["calcPrice","calcLots","calcMarginAdd","calcFeeAdd","calcTicks"].forEach(function(id){
$(id).addEventListener("change", recalc);
$(id).addEventListener("input", function(){
if(id==="calcPrice"){ state.userPriceEdited = true; }
recalc();
});
});
/* 默认选中第一个合约 */
selectCombo(contracts[0].code);
}
document.addEventListener("DOMContentLoaded", function(){
bind();
quoteLoop();
prefetchAll();
});
})();