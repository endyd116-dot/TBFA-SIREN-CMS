/* 함께워크 AX 제안서 보기·내보내기 (tbfa.co.kr/1, /2)
   주소 #쪽번호 지원, 좌우 키·손가락·전체 화면 발표, 영상은 해당 쪽에서만 재생, 그림은 가까운 쪽부터 불러온다.
   PDF·PPT는 쪽마다 사진으로 찍어 묶는다. 움직임은 멈춘 최종 화면을 찍는다. */
var deckName=document.body.getAttribute('data-file')||'함께워크 AX 제안서';
var deckLabel=document.body.getAttribute('data-label')||'함께워크 AX';
var slides=Array.from(document.querySelectorAll('.slide'));
var total=slides.length;
var cur=0;

/* 쪽 번호 */
slides.forEach(function(s,i){
  if(s.classList.contains('nofoot'))return;
  var f=document.createElement('div');
  f.className='slide-footer';
  f.innerHTML='<span>'+deckLabel+'</span><span class="pg">'+String(i+1).padStart(2,'0')+'</span>';
  s.appendChild(f);
});

/* 아래 점 */
var dotsBar=document.getElementById('dotsBar');
slides.forEach(function(s,i){
  var d=document.createElement('button');
  d.className='dot';
  d.setAttribute('aria-label',(i+1)+'쪽');
  d.onclick=function(){goTo(i);};
  dotsBar.appendChild(d);
});

/* 가까운 쪽의 그림만 먼저 불러온다 */
function loadNear(n){
  for(var i=n-1;i<=n+2;i++){
    if(i<0||i>=total)continue;
    slides[i].querySelectorAll('img[data-src]').forEach(function(im){im.src=im.getAttribute('data-src');im.removeAttribute('data-src');});
  }
}
function loadAll(){
  var ps=[];
  document.querySelectorAll('img[data-src]').forEach(function(im){im.src=im.getAttribute('data-src');im.removeAttribute('data-src');});
  document.querySelectorAll('.slide img').forEach(function(im){
    if(im.complete)return;
    ps.push(new Promise(function(r){im.onload=r;im.onerror=r;}));
  });
  return Promise.all(ps);
}

/* 영상: 지금 쪽만 재생 */
function syncVideo(){
  slides.forEach(function(s,i){
    s.querySelectorAll('video').forEach(function(v){
      if(i===cur){
        if(!v.getAttribute('src')&&v.dataset.src)v.setAttribute('src',v.dataset.src);
        var p=v.play();if(p&&p.catch)p.catch(function(){});
      }else if(!v.paused){v.pause();}
    });
  });
}

/* 숫자가 올라가는 효과. 처음 값은 글에 적힌 최종 숫자다 */
var counters=[];
function runCounters(s){
  s.querySelectorAll('[data-count]').forEach(function(e){
    var end=parseFloat(e.dataset.count),dec=(e.dataset.count.split('.')[1]||'').length,t0=performance.now(),dur=1100;
    function step(t){
      if(!e.isConnected||!s.classList.contains('active'))return;
      var k=Math.min((t-t0)/dur,1);k=1-Math.pow(1-k,3);
      var v=end*k;e.textContent=dec?v.toFixed(dec):Math.round(v).toLocaleString('ko-KR');
      if(k<1&&!document.body.classList.contains('exporting'))requestAnimationFrame(step);
      else e.textContent=dec?end.toFixed(dec):end.toLocaleString('ko-KR');
    }
    requestAnimationFrame(step);
  });
}

/* 화면 예시가 순서대로 나타나는 효과. data-d(밀리초) 뒤에 다음 항목이 나온다. 끝나면 잠시 멈췄다 다시 돈다 */
var seqTimers=[];
function clearSeq(){seqTimers.forEach(clearTimeout);seqTimers=[];document.querySelectorAll('.seq>.hid').forEach(function(e){e.classList.remove('hid');});document.querySelectorAll('[data-type]').forEach(function(e){e.textContent=e.dataset.type;});}
function runSeq(s){
  s.querySelectorAll('.seq').forEach(function(box){
    function once(){
      var items=[].slice.call(box.children),t=500;
      items.forEach(function(e){e.classList.add('hid');});
      items.forEach(function(e){
        t+=parseInt(e.dataset.d||'800',10);
        seqTimers.push(setTimeout(function(){
          e.classList.remove('hid');
          var ty=e.querySelector('[data-type]')||(e.dataset.type?e:null);
          if(ty){var txt=ty.dataset.type,i=0;ty.textContent='';(function tick(){if(i>txt.length)return;ty.textContent=txt.slice(0,i++);seqTimers.push(setTimeout(tick,32));})();}
        },t));
        if(e.querySelector('[data-type]')||e.dataset.type)t+=((e.querySelector('[data-type]')||e).dataset.type.length*32);
      });
      if(box.dataset.loop!=='0')seqTimers.push(setTimeout(once,t+5200));
    }
    once();
  });
}

function paint(){
  document.querySelectorAll('.dot').forEach(function(d,i){d.classList.toggle('active',i===cur);});
  document.getElementById('ctr').textContent=(cur+1)+' / '+total;
  document.getElementById('secInd').textContent=slides[cur].dataset.sec||'';
  try{history.replaceState(null,'',cur?'#'+(cur+1):location.pathname+location.search);}catch(e){}
}
function enter(){
  loadNear(cur);syncVideo();clearSeq();runSeq(slides[cur]);runCounters(slides[cur]);
}
function goTo(n){
  if(n<0||n>=total||n===cur)return;
  slides[cur].classList.remove('active');
  slides[cur].classList.add('out');
  var prev=cur;
  cur=n;
  slides[cur].classList.add('active');
  setTimeout(function(){slides[prev].classList.remove('out');},450);
  paint();enter();
}
function nav(d){goTo(cur+d);}

document.addEventListener('keydown',function(e){
  if(['ArrowRight','ArrowDown','PageDown',' '].indexOf(e.key)>=0){e.preventDefault();nav(1);}
  if(['ArrowLeft','ArrowUp','PageUp'].indexOf(e.key)>=0){e.preventDefault();nav(-1);}
  if(e.key==='Home')goTo(0);
  if(e.key==='End')goTo(total-1);
  if(e.key==='f'||e.key==='F')toggleFS();
});

/* 손가락으로 넘기기 */
var tx=0,ty=0;
document.addEventListener('touchstart',function(e){tx=e.touches[0].clientX;ty=e.touches[0].clientY;},{passive:true});
document.addEventListener('touchend',function(e){
  var dx=e.changedTouches[0].clientX-tx,dy=e.changedTouches[0].clientY-ty;
  if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy))nav(dx<0?1:-1);
},{passive:true});

/* 화면 크기 맞추기 */
function scaleVP(){
  var vp=document.getElementById('vp');
  var fs=!!document.fullscreenElement;
  var sw=window.innerWidth,sh=window.innerHeight;
  var s=fs?Math.min(sw/1280,sh/720):Math.min((sw-40)/1280,(sh-(sh<520?36:96))/720);
  vp.style.transform='scale('+s+')';
}
function toggleFS(){
  if(document.fullscreenElement){document.exitFullscreen();}
  else if(document.documentElement.requestFullscreen){document.documentElement.requestFullscreen();}
}
document.addEventListener('fullscreenchange',function(){document.body.classList.toggle('fs',!!document.fullscreenElement);scaleVP();});
window.addEventListener('resize',scaleVP);
scaleVP();
/* 전체 화면 발표: 슬라이드를 누르면 다음, 왼쪽 끝을 누르면 이전 */
document.getElementById('vp').addEventListener('click',function(e){if(document.body.classList.contains('fs'))nav(e.clientX<window.innerWidth*.25?-1:1);});

/* 목차에서 바로 가기 */
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-go]');if(!a)return;var i=slides.findIndex(function(s){return s.id===a.dataset.go;});if(i>=0)goTo(i);});

/* 첫 화면: 주소의 #쪽번호 지원 */
cur=Math.min(Math.max(parseInt(location.hash.slice(1),10)||1,1),total)-1;
slides[cur].classList.add('active');
paint();enter();
window.addEventListener('hashchange',function(){var n=parseInt(location.hash.slice(1),10)||1;goTo(Math.min(Math.max(n,1),total)-1);});

/* PDF / PPT 내보내기 (라이브러리 지연 로드) */
var _libs={
  h2c:'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  jspdf:'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  pptx:'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'
};
function _load(src){return new Promise(function(res,rej){
  if([].some.call(document.scripts,function(s){return s.src===src;}))return res();
  var sc=document.createElement('script');sc.src=src;sc.onload=res;sc.onerror=function(){rej(new Error('라이브러리 로드 실패'));};document.head.appendChild(sc);
});}
function _ov(on,msg,sub){var o=document.getElementById('expOverlay');o.classList.toggle('on',on);if(msg!=null)document.getElementById('expMsg').textContent=msg;if(sub!=null)document.getElementById('expSub').textContent=sub;}
async function _capture(onProg){
  var vp=document.getElementById('vp'),vpT=vp.style.transform;vp.style.transform='none';
  document.body.classList.add('exporting');
  clearSeq();
  document.querySelectorAll('video').forEach(function(v){v.pause();});
  document.querySelectorAll('[data-count]').forEach(function(e){var d=(e.dataset.count.split('.')[1]||'').length;e.textContent=d?parseFloat(e.dataset.count).toFixed(d):parseFloat(e.dataset.count).toLocaleString('ko-KR');});
  await loadAll();
  if(document.fonts&&document.fonts.ready)await document.fonts.ready;
  /* 아이콘 색을 고정한다. 그림으로 옮길 때 글자색을 따라가지 못하기 때문이다 */
  document.querySelectorAll('.slide svg').forEach(function(g){g.style.color=getComputedStyle(g).color;});
  var ss=slides,shots=[];
  for(var i=0;i<ss.length;i++){
    var s=ss[i],pst=s.getAttribute('style')||'';
    s.style.opacity='1';s.style.transition='none';s.style.pointerEvents='auto';s.style.zIndex='3';
    onProg(i+1,ss.length);
    var canvas=await html2canvas(s,{width:1280,height:720,windowWidth:1280,windowHeight:720,scale:2,backgroundColor:'#ffffff',logging:false,useCORS:true});
    shots.push(canvas.toDataURL('image/jpeg',0.9));
    s.setAttribute('style',pst);
  }
  document.body.classList.remove('exporting');
  vp.style.transform=vpT;scaleVP();enter();
  return shots;
}
async function exportDeck(kind){
  var bP=document.getElementById('btnPdf'),bT=document.getElementById('btnPpt');bP.disabled=true;bT.disabled=true;
  try{
    _ov(true,(kind==='pdf'?'PDF':'PPT')+' 생성 준비 중…','라이브러리 불러오는 중');
    await _load(_libs.h2c);await _load(kind==='pdf'?_libs.jspdf:_libs.pptx);
    var shots=await _capture(function(n,t){_ov(true,(kind==='pdf'?'PDF':'PPT')+' 생성 중…','슬라이드 캡처 '+n+' / '+t);});
    _ov(true,'파일 저장 중…','거의 다 됐습니다');
    if(kind==='pdf'){
      var jsPDF=window.jspdf.jsPDF,pdf=new jsPDF({orientation:'landscape',unit:'px',format:[1280,720],hotfixes:['px_scaling']});
      shots.forEach(function(img,i){if(i>0)pdf.addPage([1280,720],'landscape');pdf.addImage(img,'JPEG',0,0,1280,720);});
      pdf.save(deckName+'.pdf');
    }else{
      var pptx=new PptxGenJS();pptx.defineLayout({name:'W16',width:13.333,height:7.5});pptx.layout='W16';
      shots.forEach(function(img){pptx.addSlide().addImage({data:img,x:0,y:0,w:13.333,h:7.5});});
      await pptx.writeFile({fileName:deckName+'.pptx'});
    }
    _ov(false);
  }catch(e){_ov(false);alert('내보내기 실패: '+(e&&e.message||e));}
  finally{bP.disabled=false;bT.disabled=false;document.body.classList.remove('exporting');}
}
