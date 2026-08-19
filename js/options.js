(function(){
"use strict";
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];}); }
function trim0(x){ return String(Number(x).toFixed(4)).replace(/(\.\d*?)0+$/,"$1").replace(/\.$/,""); }
var state = { exch:"all", search:"" };
var EXCH_ORDER = ["中金所","上期所","郑商所","大商所","广期所","能源中心"];
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
var head = '<div class="ex-title"><span>'+ex+'</span><span class="count">'+list.length+' 个品种 · 单位：元/手</span></div>';
var table = '<div class="table-wrap"><table><thead><tr>'+
"<th>期权品种</th><th>代码</th><th>交易所</th><th>开仓</th><th>平昨</th><th>平今</th><th>行权</th>"+
"</tr></thead><tbody>"+
list.map(function(o){
return "<tr><td>"+esc(o.name)+"</td><td><b>"+esc(o.code)+"</b></td><td>"+esc(o.exch)+"</td>"+
"<td>"+trim0(o.open)+"元</td><td>"+trim0(o.closePrev)+"元</td><td>"+trim0(o.closeToday)+"元</td><td>"+trim0(o.exercise)+"元</td></tr>";
}).join("")+
"</tbody></table></div>";
blocks.push('<section class="exchange-block">'+head+table+"</section>");
});
main.innerHTML = blocks.join("") || '<div class="empty-tip">没有匹配的品种</div>';
}
function bind(){
renderTabs(); renderTable();
$("optTabs").addEventListener("click", function(e){
var t = e.target.closest(".tab"); if(!t) return;
state.exch = t.getAttribute("data-exch");
renderTabs(); renderTable();
});
$("optSearch").addEventListener("input", function(){ state.search = this.value; renderTable(); });
}
document.addEventListener("DOMContentLoaded", bind);
})();