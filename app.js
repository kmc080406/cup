(()=>{
'use strict';
const $=id=>document.getElementById(id);
const MODEL_ID='Xenova/mobileclip_s0';
const SOURCES=[
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1',
  'https://esm.sh/@huggingface/transformers@3.8.1'
];
// The model compares the image with natural-language descriptions.
// The scores are NOT calibrated probabilities of a material.
const OPTIONS=[
  {group:'paper',label:'a photo of a white disposable paper drinking cup'},
  {group:'paper',label:'a photo of a cardboard paper coffee cup'},
  {group:'paper',label:'a photo of a brown or printed paper cup'},
  {group:'plastic',label:'a photo of a transparent disposable plastic drinking cup'},
  {group:'plastic',label:'a photo of a clear plastic iced coffee cup'},
  {group:'plastic',label:'a photo of an opaque colored plastic party cup'},
  {group:'none',label:'a photo of an empty table without a cup'},
  {group:'none',label:'a photo of a human hand without any cup'}
];
const LABELS=OPTIONS.map(x=>x.label);
const state={
  page:'home',stream:null,side:'environment',running:false,starting:false,token:0,
  model:null,modelPromise:null,analysisTimer:null,history:[],lastSuccess:0
};
function showPage(page){
 state.page=page;
 for(const name of ['home','scan']){
  $(name).hidden=name!==page;
  $(name).classList.toggle('is-active',name===page);
 }
 $('topbar').hidden=page==='scan';
 $('footer').hidden=page==='scan';
 window.scrollTo(0,0);
}
function status(msg,live){
 $('cameraState').textContent=msg;
 $('livePip').classList.toggle('is-live',!!live);
}
function clearResults(title='컵을 보여주세요',detail='카메라에 비춘 컵을 분석합니다.'){
 $('resultAwait').hidden=false;
 $('resultFound').hidden=true;
 $('resultWaitingTitle').textContent=title;
 $('resultWaitingDetail').textContent=detail;
 $('paperBar').style.width='0%';
 $('plasticBar').style.width='0%';
 $('paperValue').textContent='—';
 $('plasticValue').textContent='—';
 $('analysisState').textContent='분석 전';
 $('resultFound').parentElement.parentElement.classList.remove('is-plastic');
}
function showLoading(title,detail,progress=null){
 $('cameraOverlay').hidden=false;
 $('overlayLoading').hidden=false;
 $('overlayError').hidden=true;
 $('loadingTitle').textContent=title;
 $('loadingDetail').textContent=detail;
 const bar=$('loadProgress');
 if(progress===null){bar.hidden=true;$('loadProgressFill').style.width='0%';}
 else{bar.hidden=false;$('loadProgressFill').style.width=Math.max(0,Math.min(progress,100))+'%';}
}
function messageForError(error,stage){
 const n=error?.name||'Error';
 if(n==='NotAllowedError'||n==='PermissionDeniedError'||n==='SecurityError'){
  return ['카메라 사용 권한이 필요해요','브라우저의 주소창 옆 카메라 권한을 허용한 뒤 다시 시도해 주세요.'];
 }
 if(n==='NotFoundError'||n==='DevicesNotFoundError'){
  return ['카메라를 찾을 수 없어요','휴대폰 또는 컴퓨터의 카메라가 연결되어 있는지 확인해 주세요.'];
 }
 if(n==='NotReadableError'||n==='TrackStartError'){
  return ['카메라를 열 수 없어요','다른 앱이 카메라를 사용 중이라면 종료하고 다시 시도해 주세요.'];
 }
 if(n==='NoSecureContext'){
  return ['안전한 연결이 필요해요','GitHub Pages의 https://kmc080406.github.io/cup/ 주소에서 접속해 주세요.'];
 }
 if(n==='NoCameraAPI'){
  return ['이 브라우저에서는 카메라를 사용할 수 없어요','앱 내부 미리보기가 아닌 Chrome 또는 Safari에서 주소를 직접 열어 주세요.'];
 }
 if(stage==='model'){
  return ['AI 모델을 불러오지 못했어요','처음 실행에는 약 50~70MB의 모델 파일이 필요합니다. 인터넷 연결을 확인해 주세요. ('+String(error?.message||n).slice(0,140)+')'];
 }
 return ['카메라를 시작하지 못했어요',String(error?.message||'브라우저와 카메라 권한을 확인해 주세요.').slice(0,180)];
}
function showError(err,stage){
 const info=messageForError(err,stage);
 showLoading('','');
 $('overlayLoading').hidden=true;
 $('overlayError').hidden=false;
 $('errorTitle').textContent=info[0];
 $('errorDescription').textContent=info[1];
 status('연결 실패',false);
 clearResults('인식할 수 없어요','오류 내용을 확인하고 다시 시도해 주세요.');
 $('analysisState').textContent='연결 실패';
}
function stopCamera(){
 state.running=false;
 if(state.analysisTimer){clearTimeout(state.analysisTimer);state.analysisTimer=null;}
 if(state.stream){state.stream.getTracks().forEach(track=>track.stop());state.stream=null;}
 const camera=$('camera');
 try{camera.pause();camera.srcObject=null;}catch(_){}
 status('카메라 종료',false);
}
function cancel(){
 ++state.token;
 stopCamera();
 state.starting=false;
 state.history=[];
 $('startBtn').disabled=false;
 $('flipBtn').disabled=false;
 $('retryBtn').disabled=false;
}
function backHome(){
 cancel();
 state.side='environment';
 clearResults();
 showPage('home');
}
function progressCallback(info){
 if(state.page!=='scan'||!state.starting)return;
 if(info.status==='progress'&&typeof info.progress==='number'){
  const pct=Math.max(0,Math.min(100,info.progress));
  const file=String(info.file||'');
  const source=file.includes('.onnx')?'AI 모델':'구성 파일';
  showLoading('AI 모델을 불러오고 있어요',source+' 다운로드 중 · '+Math.round(pct)+'%',pct);
 }else if(info.status==='initiate'||info.status==='download'){
  showLoading('AI 모델을 불러오고 있어요','처음 실행 시 파일을 다운로드합니다.');
 }
}
async function getModel(){
 if(state.model)return state.model;
 if(state.modelPromise)return state.modelPromise;
 state.modelPromise=(async()=>{
  let lastError;
  for(const source of SOURCES){
   try{
    const lib=await import(source);
    if(!lib.pipeline)throw Error('이미지 분류 기능을 찾지 못했습니다.');
    // MobileCLIP-S0: smaller than CLIP ViT-B/32; runs locally after download.
    const model=await lib.pipeline('zero-shot-image-classification',MODEL_ID,{
      device:'wasm',dtype:'q8',progress_callback:progressCallback
    });
    return model;
   }catch(err){
    lastError=err;
    console.warn('[컵체크] 모델 주소 재시도',source,err);
   }
  }
  throw lastError||Error('AI 모델을 준비할 수 없습니다.');
 })();
 try{state.model=await state.modelPromise;return state.model;}
 finally{state.modelPromise=null;}
}
async function openCamera(side,token){
 if(!window.isSecureContext){const e=Error('HTTPS required');e.name='NoSecureContext';throw e;}
 if(!navigator.mediaDevices?.getUserMedia){const e=Error('getUserMedia unavailable');e.name='NoCameraAPI';throw e;}
 const constraints={
  audio:false,
  video:{facingMode:{ideal:side},width:{ideal:960},height:{ideal:720}}
 };
 let stream;
 try{stream=await navigator.mediaDevices.getUserMedia(constraints);}
 catch(err){
  if(err.name==='OverconstrainedError')stream=await navigator.mediaDevices.getUserMedia({audio:false,video:true});
  else throw err;
 }
 if(token!==state.token){stream.getTracks().forEach(t=>t.stop());return;}
 state.stream=stream;
 const camera=$('camera');
 camera.srcObject=stream;
 const actual=stream.getVideoTracks()[0]?.getSettings?.().facingMode;
 const back=actual?actual==='environment':side==='environment';
 camera.classList.toggle('is-back',back);
 $('cameraSide').textContent=back?'후면 카메라':'전면 카메라';
 await camera.play();
}
async function begin(side=state.side){
 if(state.starting)return;
 const token=++state.token;
 state.starting=true;
 stopCamera();
 state.history=[];
 state.side=side;
 showPage('scan');
 clearResults('준비하고 있어요','카메라와 AI 모델을 연결하는 중입니다.');
 showLoading('카메라 연결 중','브라우저의 카메라 사용 권한을 허용해 주세요.');
 status('준비 중',false);
 $('flipBtn').disabled=true;
 $('retryBtn').disabled=true;
 let stage='camera';
 try{
  await openCamera(side,token);
  if(token!==state.token)return;
  status('카메라 연결됨',true);
  stage='model';
  showLoading('AI 모델을 불러오고 있어요','첫 실행에는 모델 파일 다운로드가 필요합니다.');
  await getModel();
  if(token!==state.token)return;
  $('cameraOverlay').hidden=true;
  state.running=true;
  status('분석 중',true);
  clearResults('컵을 보여주세요','컵 하나를 화면 중앙에 비춰 주세요.');
  $('analysisState').textContent='분석 중';
  const track=state.stream?.getVideoTracks()[0];
  track?.addEventListener('ended',()=>{
   if(token!==state.token||!state.running)return;
   stopCamera();
   showError(Error('카메라 연결이 끊어졌습니다. 다시 시작해 주세요.'),'camera');
  });
  scheduleNext(token,320);
 }catch(err){
  if(token===state.token){console.error('[컵체크] 시작 실패',stage,err);stopCamera();showError(err,stage);}
 }finally{
  if(token===state.token){
   state.starting=false;
   $('flipBtn').disabled=false;
   $('retryBtn').disabled=false;
   $('startBtn').disabled=false;
  }
 }
}
function snapshot(){
 const video=$('camera');
 if(video.readyState<2||!video.videoWidth||!video.videoHeight)return false;
 const canvas=$('sampleCanvas');
 const w=video.videoWidth,h=video.videoHeight;
 const length=Math.min(w,h)*.84;
 const x=(w-length)/2,y=(h-length)/2;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(video,x,y,length,length,0,0,canvas.width,canvas.height);
 return true;
}
function interpret(results){
 if(!Array.isArray(results))return{type:null,share:0.5,reason:'결과 없음'};
 const sums={paper:0,plastic:0,none:0};
 const maxes={paper:0,plastic:0,none:0};
 for(const item of results){
  const opt=OPTIONS.find(x=>x.label===item.label);
  if(!opt||!Number.isFinite(item.score))continue;
  sums[opt.group]+=item.score;
  maxes[opt.group]=Math.max(maxes[opt.group],item.score);
 }
 const total=sums.paper+sums.plastic;
 if(total<=.000001)return{type:null,share:.5,reason:'판별 불가'};
 const share=sums.paper/total;
 const best=Math.max(maxes.paper,maxes.plastic);
 const noCup=maxes.none>best*1.10;
 // This is a relative visual-language score, not a calibrated probability.
 const margin=Math.abs(share-.5);
 const clear=margin>.09 && best>.06 && !noCup;
 return{type:clear?(share>.5?'paper':'plastic'):null,share,reason:noCup?'컵이 보이지 않아요':margin<=.09?'재질을 확인하는 중':'다시 비춰주세요'};
}
function displayScores(share){
 const paper=Math.round(share*100),plastic=100-paper;
 $('paperBar').style.width=paper+'%';
 $('plasticBar').style.width=plastic+'%';
 $('paperValue').textContent=paper+'%';
 $('plasticValue').textContent=plastic+'%';
 $('analysisState').textContent='상대 비교';
}
function renderResult(result){
 displayScores(result.share);
 state.history.push(result.type);
 if(state.history.length>3)state.history.shift();
 const a=state.history.filter(x=>x==='paper').length;
 const b=state.history.filter(x=>x==='plastic').length;
 const stable=(a>=2&&a>b)?'paper':(b>=2&&b>a)?'plastic':null;
 if(stable){
  $('resultAwait').hidden=true;
  $('resultFound').hidden=false;
  $('foundType').textContent=stable==='paper'?'PAPER CUP':'PLASTIC CUP';
  $('foundTitle').innerHTML=stable==='paper'?'종이컵<span>!</span>':'플라스틱컵<span>!</span>';
  $('foundSubtitle').textContent=stable==='paper'?'AI가 종이컵의 특징에 더 가깝다고 추정했습니다.':'AI가 플라스틱컵의 특징에 더 가깝다고 추정했습니다.';
  $('resultFound').parentElement.parentElement.classList.toggle('is-plastic',stable==='plastic');
  state.lastSuccess=performance.now();
  status('분석 완료 · 계속 감지 중',true);
 }else{
  $('resultFound').hidden=true;
  $('resultAwait').hidden=false;
  $('resultWaitingTitle').textContent=result.reason||'재질을 확인하는 중';
  $('resultWaitingDetail').textContent='컵을 한 개만 가까이 비춰 주세요.';
  status('분석 중',true);
 }
}
function scheduleNext(token,delay){
 if(state.analysisTimer)clearTimeout(state.analysisTimer);
 state.analysisTimer=setTimeout(()=>analyze(token),delay);
}
async function analyze(token){
 if(!state.running||state.token!==token)return;
 if(document.hidden){scheduleNext(token,650);return;}
 if(!snapshot()){scheduleNext(token,350);return;}
 try{
  const output=await state.model($('sampleCanvas'),LABELS,{topk:LABELS.length});
  if(token!==state.token||!state.running)return;
  renderResult(interpret(output));
 }catch(err){
  if(token!==state.token)return;
  console.error('[컵체크] 이미지 분석 오류',err);
  stopCamera();
  showError(err,'model');
  return;
 }
 if(token===state.token&&state.running)scheduleNext(token,950);
}
$('startBtn').addEventListener('click',()=>begin('environment'));
$('brandLink').addEventListener('click',e=>{e.preventDefault();backHome();});
$('backBtn').addEventListener('click',backHome);
$('retryBtn').addEventListener('click',()=>begin(state.side));
$('flipBtn').addEventListener('click',()=>begin(state.side==='environment'?'user':'environment'));
$('errorRetry').addEventListener('click',()=>begin(state.side));
$('errorBack').addEventListener('click',backHome);
$('helpBtn').addEventListener('click',()=>{
 $('helpPanel').hidden=!$('helpPanel').hidden;
 $('helpBtn').setAttribute('aria-expanded',String(!$('helpPanel').hidden));
});
window.addEventListener('pagehide',cancel);
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){state.history=[];}
});
window.__cupcheck={
 interpret,
 getState:()=>({page:state.page,running:state.running,side:state.side,modelReady:!!state.model})
};
})();
