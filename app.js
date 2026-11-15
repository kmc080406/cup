(()=>{
'use strict';
const $=id=>document.getElementById(id);
const MODEL_ID='Xenova/mobileclip_s0';
const MP_VERSION='0.10.22-rc.20250304';
const MP_CDN=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const DETECTOR_MODEL='https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';
const TRAIN_KEY='cupcheck-material-prototypes-v1';
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
  model:null,modelPromise:null,detector:null,detectorPromise:null,analysisTimer:null,history:[],misses:0,training:null,trained:{},lastSuccess:0
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
function clearResults(label='아무것도 없음'){
 $('resultAwait').hidden=false;
 $('resultFound').hidden=true;
 $('resultWaitingTitle').textContent=label;
 $('resultWaitingDetail').textContent='';
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
  return ['AI 모델을 불러오지 못했어요','AI 파일 다운로드에 실패했습니다. 연결 상태를 확인해 주세요. ('+String(error?.message||n).slice(0,150)+')'];
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
 state.misses=0;
 state.training=null;
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
async function loadMobileCLIP(lib){
 // The MobileCLIP S0 repository contains two separate ONNX models:
 // onnx/text_model_quantized.onnx and onnx/vision_model_quantized.onnx.
 // A zero-shot image pipeline would request missing onnx/model_quantized.onnx.
 const required=['AutoTokenizer','CLIPTextModelWithProjection','AutoProcessor','CLIPVisionModelWithProjection','RawImage','dot','softmax'];
 const missing=required.filter(key=>!lib[key]);
 if(missing.length)throw Error('AI 라이브러리에 필요한 기능이 없습니다: '+missing.join(', '));
 const modelOptions={device:'wasm',dtype:'q8',progress_callback:progressCallback};
 showLoading('AI 모델을 불러오고 있어요','문장 분석 모델을 준비 중입니다.');
 const tokenizer=await lib.AutoTokenizer.from_pretrained(MODEL_ID,{progress_callback:progressCallback});
 const textModel=await lib.CLIPTextModelWithProjection.from_pretrained(MODEL_ID,modelOptions);
 const tokens=tokenizer(LABELS,{padding:'max_length',truncation:true});
 const {text_embeds}=await textModel(tokens);
 const textVectors=text_embeds.normalize().tolist();
 if(!Array.isArray(textVectors)||textVectors.length!==LABELS.length)throw Error('문장 특징을 계산하지 못했습니다.');
 // Text embeddings are fixed; keep only their vectors during camera inference.
 if(typeof textModel.dispose==='function')await textModel.dispose();
 showLoading('AI 모델을 불러오고 있어요','영상 분석 모델을 준비 중입니다.');
 const processor=await lib.AutoProcessor.from_pretrained(MODEL_ID,{progress_callback:progressCallback});
 const visionModel=await lib.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID,modelOptions);
 return async function classifyCanvas(canvas){
  const frame=lib.RawImage.fromCanvas(canvas);
  const imageInputs=await processor(frame);
  const {image_embeds}=await visionModel(imageInputs);
  const imageVectors=image_embeds.normalize().tolist();
  const imageVector=imageVectors?.[0];
  if(!imageVector)throw Error('영상 특징을 계산하지 못했습니다.');
  // Softmax outputs relative similarities, not physical material probabilities.
  const probs=lib.softmax(textVectors.map(vector=>100*lib.dot(imageVector,vector)));
  return {scores:LABELS.map((label,i)=>({label,score:Number(probs[i])})),embedding:imageVector};
 };
}
async function getModel(){
 if(state.model)return state.model;
 if(state.modelPromise)return state.modelPromise;
 state.modelPromise=(async()=>{
  let lastError;
  for(const source of SOURCES){
   try{
    const lib=await import(source);
    return await loadMobileCLIP(lib);
   }catch(error){
    lastError=error;
    console.warn('[컵체크] AI 로딩 재시도',source,error);
    // A model or network error can still be diagnosed in the error message.
   }
  }
  throw lastError||Error('AI 모델을 불러오지 못했습니다.');
 })();
 try{state.model=await state.modelPromise;return state.model;}
 finally{state.modelPromise=null;}
}
async function getDetector(){
 if(state.detector)return state.detector;
 if(state.detectorPromise)return state.detectorPromise;
 state.detectorPromise=(async()=>{
  const pkg=await import(MP_CDN+'/vision_bundle.mjs');
  const mp=pkg.ObjectDetector&&pkg.FilesetResolver?pkg:pkg.default;
  if(!mp?.ObjectDetector||!mp?.FilesetResolver)throw Error('컵 탐지 모듈이 없습니다.');
  const files=await mp.FilesetResolver.forVisionTasks(MP_CDN+'/wasm');
  return await mp.ObjectDetector.createFromOptions(files,{
    baseOptions:{modelAssetPath:DETECTOR_MODEL,delegate:'CPU'},
    runningMode:'VIDEO',scoreThreshold:.22,maxResults:7
  });
 })();
 try{state.detector=await state.detectorPromise;return state.detector;}
 finally{state.detectorPromise=null;}
}
function cupBox(detections,width,height){
 const cups=(detections||[])
  .filter(d=>(d.categories||[]).some(c=>String(c.categoryName||c.displayName||'').toLowerCase()==='cup'))
  .filter(d=>d.boundingBox && d.boundingBox.width*d.boundingBox.height>width*height*.009);
 if(!cups.length)return null;
 const metric=d=>{
  const b=d.boundingBox,cx=b.originX+b.width/2,cy=b.originY+b.height/2;
  const central=1-Math.min(1,Math.hypot(cx-width/2,cy-height/2)/Math.hypot(width/2,height/2));
  return (d.categories[0]?.score||0)+.18*central+.09*Math.min(1,b.width*b.height/(width*height*.25));
 };
 cups.sort((a,b)=>metric(b)-metric(a));
 return cups[0].boundingBox;
}
function openFeatureStore(){
 try{
  const raw=JSON.parse(localStorage.getItem(TRAIN_KEY)||'{}');
  for(const k of ['paper','plastic']){
   if(Array.isArray(raw[k])&&raw[k].length>=128&&raw[k].length<=1024&&raw[k].every(Number.isFinite))state.trained[k]=raw[k];
  }
 }catch(err){console.warn('[컵체크] 보정 데이터 미사용',err);}
 trainingMessage();
}
function trainingMessage(message){
 if(message){$('trainStatus').textContent=message;return;}
 const classes=['paper','plastic'].filter(k=>state.trained[k]);
 $('trainStatus').textContent=classes.length===2?'종이컵·플라스틱컵 보정이 완료됐습니다.':
 classes.length===1?'한 종류 보정 완료. 두 컵을 모두 보정하면 인식에 도움이 됩니다.':
 '보정하지 않아도 기본 모델을 사용할 수 있습니다.';
}
function normalized(v){
 const length=Math.sqrt(v.reduce((s,x)=>s+x*x,0))||1;
 return v.map(x=>x/length);
}
function cosine(a,b){
 if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return -1;
 let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];
 return s;
}
function classifyMaterial({scores,embedding}){
 const sums={paper:0,plastic:0};
 for(const r of scores||[]){
  const p=OPTIONS.find(o=>o.label===r.label);
  if((p?.group==='paper'||p?.group==='plastic')&&Number.isFinite(r.score))sums[p.group]+=r.score;
 }
 const share=sums.paper/Math.max(.00001,sums.paper+sums.plastic);
 if(state.trained.paper&&state.trained.plastic){
  const paper=cosine(embedding,state.trained.paper),plastic=cosine(embedding,state.trained.plastic);
  if(Math.max(paper,plastic)>.55&&Math.abs(paper-plastic)>.012)return paper>plastic?'paper':'plastic';
 }
 if(share>.55)return 'paper';
 if(share<.45)return 'plastic';
 return null;
}
function addTrainingSample(embedding){
 const t=state.training;
 if(!t||!Array.isArray(embedding)||!embedding.length)return;
 t.samples.push(embedding);
 trainingMessage((t.type==='paper'?'종이컵':'플라스틱컵')+' 보정 중 · '+t.samples.length+'/5');
 if(t.samples.length<5)return;
 const len=t.samples[0].length;
 const avg=Array.from({length:len},(_,i)=>t.samples.reduce((s,v)=>s+v[i],0)/t.samples.length);
 state.trained[t.type]=normalized(avg);
 state.training=null;
 try{localStorage.setItem(TRAIN_KEY,JSON.stringify(state.trained));}catch(_){}
 trainingMessage();
}
function beginTraining(type){
 if(!state.running){trainingMessage('카메라를 시작한 뒤 보정해 주세요.');return;}
 state.training={type,samples:[]};state.history=[];
 trainingMessage((type==='paper'?'종이컵':'플라스틱컵')+'을 가운데 보여주세요.');
}
function resetTraining(){
 state.training=null;state.trained={};
 try{localStorage.removeItem(TRAIN_KEY);}catch(_){}
 trainingMessage('보정을 초기화했습니다.');
}
function saveCrop(b){
 const v=$('camera'),canvas=$('sampleCanvas'),width=v.videoWidth,height=v.videoHeight;
 if(!width||!height)return false;
 const cx=b.originX+b.width/2,cy=b.originY+b.height/2;
 const side=Math.max(b.width,b.height)*1.32;
 const w=Math.min(width,side),h=Math.min(height,side);
 const x=Math.min(width-w,Math.max(0,cx-w/2)),y=Math.min(height-h,Math.max(0,cy-h/2));
 canvas.getContext('2d',{willReadFrequently:true}).drawImage(v,x,y,w,h,0,0,canvas.width,canvas.height);
 return true;
}
async function openCamera(side,token){
 if(!window.isSecureContext){const e=Error('HTTPS required');e.name='NoSecureContext';throw e;}
 if(!navigator.mediaDevices?.getUserMedia){const e=Error('getUserMedia unavailable');e.name='NoCameraAPI';throw e;}
 let stream;
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:side},width:{ideal:960},height:{ideal:720}}});
 }catch(err){
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
 state.misses=0;
 state.training=null;
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
  showLoading('컵 탐지 AI를 불러오고 있어요','컵이 보이는지 먼저 확인합니다.');
  await getDetector();
  if(token!==state.token)return;
  showLoading('재질 분석 AI를 불러오고 있어요','처음 실행 시 모델을 다운로드합니다.');
  await getModel();
  if(token!==state.token)return;
  $('cameraOverlay').hidden=true;
  state.running=true;
  status('분석 중',true);
  clearResults('아무것도 없음');
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
function showAnswer(type){
 const panel=$('resultFound').parentElement.parentElement;
 if(type==='paper'||type==='plastic'){
  $('resultAwait').hidden=true;$('resultFound').hidden=false;
  $('foundTitle').textContent=type==='paper'?'종이컵':'플라스틱컵';
  panel.classList.toggle('is-plastic',type==='plastic');
 }else{
  $('resultAwait').hidden=false;$('resultFound').hidden=true;
  $('resultWaitingTitle').textContent=type==='unknown'?'판별 중':'아무것도 없음';
  $('resultWaitingDetail').textContent='';
  panel.classList.remove('is-plastic');
 }
}
function updateStableMaterial(type){
 state.history.push(type);
 if(state.history.length>4)state.history.shift();
 const count=state.history.filter(x=>x===type).length;
 if(type&&count>=2)showAnswer(type);
 else if(!type&&state.history.length>=3)showAnswer('unknown');
}
function scheduleNext(token,delay){
 if(state.analysisTimer)clearTimeout(state.analysisTimer);
 state.analysisTimer=setTimeout(()=>analyze(token),delay);
}
async function analyze(token){
 if(!state.running||token!==state.token)return;
 if(document.hidden){scheduleNext(token,850);return;}
 const video=$('camera');
 if(video.readyState<2||!video.videoWidth){scheduleNext(token,380);return;}
 try{
  const detections=state.detector.detectForVideo(video,performance.now());
  const box=cupBox(detections?.detections,video.videoWidth,video.videoHeight);
  if(!box){
   state.misses++;
   state.history=[];
   if(state.misses>=2){
    showAnswer(null);status('컵 없음',true);
    if(state.training)trainingMessage('컵이 보이지 않습니다. 컵을 가운데 보여주세요.');
   }
   scheduleNext(token,550);return;
  }
  state.misses=0;status('컵 분석 중',true);
  if(!saveCrop(box)){scheduleNext(token,400);return;}
  const result=await state.model($('sampleCanvas'));
  if(token!==state.token||!state.running)return;
  if(state.training){
   addTrainingSample(result.embedding);
   scheduleNext(token,600);return;
  }
  updateStableMaterial(classifyMaterial(result));
  scheduleNext(token,930);
 }catch(err){
  if(token!==state.token)return;
  console.error('[컵체크] 분석 오류',err);
  stopCamera();showError(err,'model');
 }
}
$('startBtn').addEventListener('click',()=>begin('environment'));
$('brandLink').addEventListener('click',e=>{e.preventDefault();backHome();});
$('backBtn').addEventListener('click',backHome);
$('retryBtn').addEventListener('click',()=>begin(state.side));
$('flipBtn').addEventListener('click',()=>begin(state.side==='environment'?'user':'environment'));
$('errorRetry').addEventListener('click',()=>begin(state.side));
$('errorBack').addEventListener('click',backHome);
document.querySelectorAll('[data-train]').forEach(b=>b.addEventListener('click',()=>beginTraining(b.dataset.train)));
$('resetTraining').addEventListener('click',resetTraining);
openFeatureStore();
$('helpBtn').addEventListener('click',()=>{
 $('helpPanel').hidden=!$('helpPanel').hidden;
 $('helpBtn').setAttribute('aria-expanded',String(!$('helpPanel').hidden));
});
window.addEventListener('pagehide',cancel);
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){state.history=[];}
});
window.__cupcheck={
 classifyMaterial,cupBox,
 getState:()=>({page:state.page,running:state.running,side:state.side,modelReady:!!state.model})
};
})();
