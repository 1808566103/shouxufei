(function(){
"use strict";
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];}); }
function trim0(x){ return String(Number(x).toFixed(4)).replace(/(\.\d*?)0+$/,"$1").replace(/\.$/,""); }
function feeCell(v){
if(Number(v)===0){ return '<span class="fee-free" title="平今免收">免收</span>'; }
return trim0(v)+"元";
}
var state = { exch:"all", search:"" };
var EXCH_ORDER = ["中金所","上期所","郑商所","大商所","广期所","能源中心"];
function renderMaintain(){
var dateEl = $("optSyncDate"), daysEl = $("optDays");
if(!dateEl || !daysEl || typeof OPTION_SYNC_DATE === "undefined") return;
dateEl.textContent = OPTION_SYNC_DATE;
var last = new Date(OPTION_SYNC_DATE.replace(/-/g,"/"));
var days = Math.max(0, Math.floor((Date.now() - last.getTime())/86400000));
daysEl.className = "";
daysEl.textContent = days + " 天";
if(days > 35){
daysEl.className = "warn";
daysEl.textContent = days + " 天，已超过每月核对周期，请提醒站长核对最新公告";
}
}
function match(o){
var q = state.search.trim().toLowerCase();
if(!q) return true;
return (o.name+" "+o.code+" "+o.exch).toLowerCase().indexOf(q) !== -1;
}
function renderTabs(){
$("optTabs").innerHTML = '<div class="tab'+(state.exch==="all"?" active":"")+'" data-exch="all">全部</div>'+
EXCH_ORDER.map(function(ex){
var n = OPTIONS.filter(function(o){ return o.exch===ex; }).length;
return '<div class="tab'+(state.exch===ex?" active":"")+'" data-exch="'+ex+'">'+ex+" ("+n+")</div>";
}).join("");
}
function renderTable(){
$("optCount").textContent = OPTIONS.length;
var main = $("optMain");
var blocks = [];
EXCH_ORDER.forEach(function(ex){
var list = OPTIONS.filter(function(o){ return o.exch===ex && match(o); });
if(state.exch!=="all" && state.exch!==ex) return;
if(state.exch==="all" && list.length===0) return;
var head = '<div class="ex-title"><span>'+ex+'</span><span class="count">'+list.length+' 个品种 · 单位：元/手 · <span class="fee-free">免收</span>表示平今免费</span></div>';
var table = '<div class="table-wrap"><table><thead><tr>'+
"<th>期权品种</th><th>代码</th><th>开仓</th><th>平昨</th><th>平今</th><th>行权</th>"+
"</tr></thead><tbody>"+
list.map(function(o){
return "<tr><td><span class='opt-name'>"+esc(o.name)+"</span>"+
(o.remark?'<span class="opt-rem">'+esc(o.remark)+"</span>":"")+
"</td><td><b>"+esc(o.code)+"</b></td>"+
"<td>"+feeCell(o.open)+"</td><td>"+feeCell(o.closePrev)+"</td><td>"+feeCell(o.closeToday)+"</td><td>"+feeCell(o.exercise)+"</td></tr>";
}).join("")+
"</tbody></table></div>";
blocks.push('<section class="exchange-block">'+head+table+"</section>");
});
main.innerHTML = blocks.join("") || '<div class="empty-tip">没有匹配的品种</div>';
}
function bind(){
renderMaintain(); renderTabs(); renderTable();
$("optTabs").addEventListener("click", function(e){
var t = e.target.closest(".tab"); if(!t) return;
state.exch = t.getAttribute("data-exch");
renderTabs(); renderTable();
});
$("optSearch").addEventListener("input", function(){ state.search = this.value; renderTable(); });
}
document.addEventListener("DOMContentLoaded", bind);
})();