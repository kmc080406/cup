(()=>{
'use strict';
const $=id=>document.getElementById(id);
const MODEL_ID='Xenova/mobileclip_s0';
const MP_VERSION='0.10.22-rc.20250304';
const MP_CDN=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const DETECTOR_MODEL='https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';
const TRAIN_KEY='cupcheck-material-examples-v2';
const SOURCES=[
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1',
  'https://esm.sh/@huggingface/transformers@3.8.1'
];
// The model compares the image with natural-language descriptions.
// The scores are NOT calibrated probabilities of a material.
const OPTIONS=[
 {group:'paper',label:'a photo of a matte white disposable paper drinking cup'},
 {group:'paper',label:'a photo of a brown kraft cardboard paper cup for hot coffee'},
 {group:'paper',label:'a photo of a printed paper takeaway coffee cup'},
 {group:'paper',label:'a photo of a paper cup with a rolled rim and a cardboard wall'},
 {group:'paper',label:'a single paper drinking cup standing on a table'},
 {group:'plastic',label:'a photo of a clear transparent plastic cup for iced drinks'},
 {group:'plastic',label:'a photo of a disposable glossy plastic cup with reflections'},
 {group:'plastic',label:'a photo of a translucent plastic drinking cup'},
 {group:'plastic',label:'a photo of a solid colored plastic party cup'},
 {group:'plastic',label:'a photo of an opaque white plastic disposable cup'},
 {group:'none',label:'a photo of an empty table with no cup'},
 {group:'none',label:'a photo of a hand without a drinking cup'}
];
const LABELS=OPTIONS.map(x=>x.label);
const state={
  page:'home',stream:null,side:'environment',running:false,starting:false,token:0,
  model:null,modelPromise:null,detector:null,detectorPromise:null,photoCaptured:false,photoBusy:false,shotSeq:0,lastEmbedding:null,trained:{paper:[],plastic:[]}
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
function clearResults(label='촬영 대기'){
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
 clearResults('분석 실패');
 
}
function setShutter(mode){
 const button=$('captureBtn');
 const label=$('captureLabel');
 if(mode==='loading'){
  button.disabled=true;button.classList.remove('is-retake');label.textContent='준비 중';
 }else if(mode==='ready'){
  button.disabled=false;button.classList.remove('is-retake');label.textContent='사진 찍기';
 }else if(mode==='processing'){
  button.disabled=true;button.classList.remove('is-retake');label.textContent='분석 중';
 }else{
  button.disabled=false;button.classList.add('is-retake');label.textContent='다시 촬영';
 }
}
function thawPhoto(){
 $('cameraPanel').classList.remove('is-frozen');
 $('frozenCanvas').hidden=true;
 state.photoCaptured=false;
 state.lastEmbedding=null;
 state.photoBusy=false;
}
function stopCamera(){
 state.running=false;state.shotSeq++;
 if(state.stream){state.stream.getTracks().forEach(track=>track.stop());state.stream=null;}
 const camera=$('camera');
 try{camera.pause();camera.srcObject=null;}catch(_){}
 status('카메라 종료',false);
}
function cancel(){
 ++state.token;
 stopCamera();thawPhoto();
 state.starting=false;
 $('startBtn').disabled=false;$('flipBtn').disabled=false;$('retryBtn').disabled=false;
 setShutter('loading');
}
function backHome(){
 cancel();state.side='environment';
 clearResults('촬영 대기');
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
    runningMode:'IMAGE',scoreThreshold:.15,maxResults:10
  });
 })();
 try{state.detector=await state.detectorPromise;return state.detector;}
 finally{state.detectorPromise=null;}
}
function cupBox(detections,width,height){
 const cups=(detections||[])
  .filter(d=>(d.categories||[]).some(c=>String(c.categoryName||c.displayName||'').toLowerCase()==='cup'||String(c.categoryName||c.displayName||'').toLowerCase()==='wine glass'))
  .filter(d=>d.boundingBox && d.boundingBox.width*d.boundingBox.height>width*height*.005);
 if(!cups.length)return null;
 const metric=d=>{
  const b=d.boundingBox,cx=b.originX+b.width/2,cy=b.originY+b.height/2;
  const central=1-Math.min(1,Math.hypot(cx-width/2,cy-height/2)/Math.hypot(width/2,height/2));
  return (d.categories[0]?.score||0)+.18*central+.09*Math.min(1,b.width*b.height/(width*height*.25));
 };
 cups.sort((a,b)=>metric(b)-metric(a));
 return cups[0].boundingBox;
}
function normalizeVector(vector){
 if(!Array.isArray(vector)||!vector.length)return null;
 const length=Math.sqrt(vector.reduce((s,v)=>s+v*v,0))||1;
 return vector.map(x=>x/length);
}
function similarity(a,b){
 if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return -1;
 let sum=0;for(let i=0;i<a.length;i++)sum+=a[i]*b[i];
 return sum;
}
function openFeatureStore(){
 try{
  const raw=JSON.parse(localStorage.getItem(TRAIN_KEY)||'{}');
  for(const type of ['paper','plastic']){
   if(Array.isArray(raw[type])){
    state.trained[type]=raw[type].filter(v=>Array.isArray(v)&&v.length>=128&&v.length<=1024&&v.every(Number.isFinite)).slice(-12);
   }
  }
 }catch(err){console.warn('[컵체크] 저장된 보정 데이터 사용 불가',err);}
 trainingMessage();
}
function trainingMessage(message){
 if(message){$('trainStatus').textContent=message;return;}
 const paper=state.trained.paper.length,plastic=state.trained.plastic.length;
 $('trainStatus').textContent=paper||plastic
  ? '등록된 사진 특징: 종이컵 '+paper+'장 · 플라스틱컵 '+plastic+'장 (이 기기에만 저장됨)'
  : '촬영한 사진의 결과가 틀렸을 때 올바른 컵을 등록해 주세요.';
}
function weightedModelVote(result){
 const sums={paper:0,plastic:0};
 for(const entry of result.scores||[]){
  const opt=OPTIONS.find(o=>o.label===entry.label);
  if((opt?.group==='paper'||opt?.group==='plastic')&&Number.isFinite(entry.score))sums[opt.group]+=entry.score;
 }
 return sums.paper/Math.max(1e-7,sums.paper+sums.plastic);
}
function classifyByExamples(embedding,confidence=.80,gap=.032){
 const a=state.trained.paper,b=state.trained.plastic;
 if(!a.length||!b.length||!Array.isArray(embedding))return null;
 const paper=Math.max(...a.map(ex=>similarity(ex,embedding)));
 const plastic=Math.max(...b.map(ex=>similarity(ex,embedding)));
 if(Math.max(paper,plastic)<confidence||Math.abs(paper-plastic)<gap)return null;
 return paper>plastic?'paper':'plastic';
}
function classifyMaterial(result){
 const share=weightedModelVote(result);
 const a=state.trained.paper,b=state.trained.plastic;
 if(a.length>0&&b.length>0&&Array.isArray(result.embedding)){
  const paper=Math.max(...a.map(ex=>similarity(ex,result.embedding)));
  const plastic=Math.max(...b.map(ex=>similarity(ex,result.embedding)));
  // Personal examples are more relevant to the actual cups used at the presentation.
  if(Math.max(paper,plastic)>.58&&Math.abs(paper-plastic)>.013){
   return paper>plastic?'paper':'plastic';
  }
 }
 if(share>.54)return 'paper';
 if(share<.46)return 'plastic';
 return null;
}
function saveCrop(source,b,scale=1.26){
 const canvas=$('sampleCanvas'),w=source.width,h=source.height;
 if(!w||!h)return false;
 const cx=b.originX+b.width/2,cy=b.originY+b.height/2;
 const side=Math.min(Math.max(b.width,b.height)*scale,Math.min(w,h));
 const x=Math.max(0,Math.min(w-side,cx-side/2));
 const y=Math.max(0,Math.min(h-side,cy-side/2));
 canvas.getContext('2d',{willReadFrequently:true}).drawImage(source,x,y,side,side,0,0,canvas.width,canvas.height);
 return true;
}
function centralCrop(source){
 const w=source.width,h=source.height;
 const side=Math.min(w,h)*.74;
 return {originX:(w-side)/2,originY:(h-side)/2,width:side,height:side};
}
async function extractCupFeatures(captured,box){
 if(!saveCrop(captured,box,1.15))throw Error('사진을 읽을 수 없습니다.');
 const first=await state.model($('sampleCanvas'));
 // Analyze the same frozen image at two crops, not two camera frames.
 if(!saveCrop(captured,box,1.48))throw Error('사진을 읽을 수 없습니다.');
 const second=await state.model($('sampleCanvas'));
 const combine=first.scores.map((entry,i)=>({
  label:entry.label,score:.65*entry.score+.35*(second.scores[i]?.score||0)
 }));
 const avg=first.embedding.map((x,i)=>.65*x+.35*(second.embedding[i]||0));
 return{scores:combine,embedding:normalizeVector(avg)};
}
function showAnswer(type){
 const panel=$('resultFound').parentElement.parentElement;
 if(type==='paper'||type==='plastic'){
  $('resultAwait').hidden=true;$('resultFound').hidden=false;
  $('foundTitle').textContent=type==='paper'?'종이컵':'플라스틱컵';
  panel.classList.toggle('is-plastic',type==='plastic');
 }else{
  $('resultAwait').hidden=false;$('resultFound').hidden=true;
  $('resultWaitingTitle').textContent=type==='unknown'?'판별 어려움':'아무것도 없음';
  $('resultWaitingDetail').textContent='';
  panel.classList.remove('is-plastic');
 }
}
async function registerPhoto(type){
 if(!state.photoCaptured||state.photoBusy){
  trainingMessage('먼저 사진을 찍고 분석이 끝난 뒤 등록해 주세요.');
  return;
 }
 const shot=state.shotSeq;const captured=$('frozenCanvas');
 if(!state.lastEmbedding){
  trainingMessage('사진의 특징을 분석하고 있습니다.');
  try{
   const result=await extractCupFeatures(captured,centralCrop(captured));
   if(shot!==state.shotSeq)return;
   state.lastEmbedding=result.embedding;
  }catch(err){
   trainingMessage('특징을 계산하지 못했습니다. 다시 촬영해 주세요.');
   return;
  }
 }
 if(!state.lastEmbedding)return;
 state.trained[type].push([...state.lastEmbedding]);
 state.trained[type]=state.trained[type].slice(-12);
 try{localStorage.setItem(TRAIN_KEY,JSON.stringify(state.trained));}catch(err){console.warn('[컵체크] 보정 저장 실패',err);}
 showAnswer(type);trainingMessage();
}
function resetTraining(){
 state.trained={paper:[],plastic:[]};
 try{localStorage.removeItem(TRAIN_KEY);}catch(_){}
 trainingMessage('등록된 컵 특징을 초기화했습니다.');
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
 state.starting=true;stopCamera();thawPhoto();state.side=side;
 showPage('scan');clearResults('촬영 대기');
 showLoading('카메라 연결 중','브라우저에서 카메라 사용을 허용해 주세요.');
 status('준비 중',false);setShutter('loading');
 $('flipBtn').disabled=true;$('retryBtn').disabled=true;
 let stage='camera';
 try{
  await openCamera(side,token);
  if(token!==state.token)return;
  stage='model';
  showLoading('AI를 불러오고 있어요','컵 탐지 및 재질 분석 모델을 준비 중입니다.');
  await getDetector();
  if(token!==state.token)return;
  await getModel();
  if(token!==state.token)return;
  $('cameraOverlay').hidden=true;
  state.running=true;
  status('촬영 준비 완료',true);
  setShutter('ready');
  clearResults('촬영 대기');
  state.stream?.getVideoTracks()[0]?.addEventListener('ended',()=>{
   if(token!==state.token||!state.running)return;
   stopCamera();showError(Error('카메라 연결이 끊겼습니다.'),'camera');
  });
 }catch(error){
  if(token===state.token){console.error('[컵체크] 시작 실패',stage,error);stopCamera();showError(error,stage);}
 }finally{
  if(token===state.token){
   state.starting=false;
   $('flipBtn').disabled=false;$('retryBtn').disabled=false;$('startBtn').disabled=false;
  }
 }
}
async function capture(){
 if(!state.running||state.photoBusy)return;
 if(state.photoCaptured){
  state.shotSeq++;thawPhoto();clearResults('촬영 대기');
  setShutter('ready');status('촬영 준비 완료',true);
  return;
 }
 const camera=$('camera');
 if(camera.readyState<2||!camera.videoWidth)return;
 const frozen=$('frozenCanvas');
 frozen.width=camera.videoWidth;frozen.height=camera.videoHeight;
 frozen.getContext('2d',{willReadFrequently:true}).drawImage(camera,0,0,frozen.width,frozen.height);
 frozen.classList.toggle('is-back',camera.classList.contains('is-back'));
 frozen.hidden=false;
 $('cameraPanel').classList.add('is-frozen');
 state.photoCaptured=true;state.photoBusy=true;state.lastEmbedding=null;
 const shot=++state.shotSeq;
 setShutter('processing');clearResults('분석 중');status('사진 분석 중',true);
 try{
  const detections=state.detector.detect(frozen);
  const box=cupBox(detections?.detections,frozen.width,frozen.height);
  if(!box){
   // A calibrated cup might be missed by the generic COCO object detector.
   // Use a much stricter image similarity check only when BOTH materials
   // have real examples. Otherwise an empty frame remains 'nothing'.
   if(state.trained.paper.length&&state.trained.plastic.length){
    const fallback=await extractCupFeatures(frozen,centralCrop(frozen));
    if(shot!==state.shotSeq||!state.photoCaptured)return;
    state.lastEmbedding=fallback.embedding;
    showAnswer(classifyByExamples(fallback.embedding)||null);
   }else{
    showAnswer(null);
   }
   status('분석 완료',true);
  }else{
   const result=await extractCupFeatures(frozen,box);
   if(shot!==state.shotSeq||!state.photoCaptured)return;
   state.lastEmbedding=result.embedding;
   showAnswer(classifyMaterial(result)||'unknown');
   status('분석 완료',true);
  }
 }catch(err){
  if(shot!==state.shotSeq)return;
  console.error('[컵체크] 사진 분석 실패',err);
  clearResults('분석 실패');
  status('분석 실패',true);
 }finally{
  if(shot===state.shotSeq){state.photoBusy=false;setShutter('retake');}
 }
}

$('startBtn').addEventListener('click',()=>begin('environment'));
$('captureBtn').addEventListener('click',capture);
$('brandLink').addEventListener('click',e=>{e.preventDefault();backHome();});
$('backBtn').addEventListener('click',backHome);
$('retryBtn').addEventListener('click',()=>begin(state.side));
$('flipBtn').addEventListener('click',()=>begin(state.side==='environment'?'user':'environment'));
$('errorRetry').addEventListener('click',()=>begin(state.side));
$('errorBack').addEventListener('click',backHome);
document.querySelectorAll('[data-train]').forEach(b=>b.addEventListener('click',()=>registerPhoto(b.dataset.train)));
$('resetTraining').addEventListener('click',resetTraining);
openFeatureStore();
$('helpBtn').addEventListener('click',()=>{
 $('helpPanel').hidden=!$('helpPanel').hidden;
 $('helpBtn').setAttribute('aria-expanded',String(!$('helpPanel').hidden));
});
window.addEventListener('pagehide',cancel);
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){/* photo analysis is intentionally one-shot */}
});
window.__cupcheck={
 classifyMaterial,cupBox,
 getState:()=>({page:state.page,running:state.running,side:state.side,photoCaptured:state.photoCaptured,modelReady:!!state.model})
};
})();
