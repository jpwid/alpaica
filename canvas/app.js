const roomImages={
  Woonkamer:{src:"assets/woonkamer-basis.png",alt:"Conceptbeeld van de woonkamer gezien vanuit de corridor"},
  Keuken:{src:"assets/woonkamer-basis.png",alt:"Conceptbeeld van de keuken en leefruimte"},
  Slaapkamer:{src:"assets/master-bedroom.png",alt:"Basisbeeld van de grote slaapkamer met houten wanden en glazen garderobe"}
};

const state={zone:"Woonkamer",room:"Woonkamer",camera:"Corridor",photos:[],look:0,pendingGeneration:false,accessToken:localStorage.getItem("canvasAccessToken")||""};
const el={zones:[...document.querySelectorAll(".zone")],selectedZone:document.querySelector("#selectedZone"),generationTarget:document.querySelector("#generationTarget"),dropzone:document.querySelector("#dropzone"),fileInput:document.querySelector("#fileInput"),folderInput:document.querySelector("#folderInput"),photoGrid:document.querySelector("#photoGrid"),photoCount:document.querySelector("#photoCount"),generateButton:document.querySelector("#generateButton"),generationHint:document.querySelector("#generationHint"),previewCard:document.querySelector("#previewCard"),previewImage:document.querySelector("#previewImage"),previewRoom:document.querySelector("#previewRoom"),previewCaption:document.querySelector("#previewCaption"),renderStatus:document.querySelector("#renderStatus b"),roomTabs:[...document.querySelectorAll("[data-room-tab]")],cameras:[...document.querySelectorAll("[data-camera]")],ideaText:document.querySelector("#ideaText"),toast:document.querySelector("#toast"),resetButton:document.querySelector("#resetButton"),zoneMenuButton:document.querySelector("#zoneMenuButton"),accessDialog:document.querySelector("#accessDialog"),accessForm:document.querySelector("#accessForm"),accessPassword:document.querySelector("#accessPassword"),accessError:document.querySelector("#accessError"),accessSubmit:document.querySelector("#accessSubmit"),accessClose:document.querySelector("#accessClose")};

function showToast(message){el.toast.textContent=message;el.toast.classList.add("visible");clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.toast.classList.remove("visible"),2600)}
function zonePhotos(){return state.photos.filter(photo=>photo.zone===state.zone)}
function isMasterSuite(){return state.zone==="Master suite"}

function showRoomBase(){
  const image=roomImages[state.room]||roomImages.Woonkamer;
  el.previewImage.src=image.src;el.previewImage.alt=image.alt;el.previewImage.style.filter="";el.previewImage.style.transform="";
  if(isMasterSuite()){
    el.previewCaption.textContent="Grote slaapkamer · vast basisbeeld";el.renderStatus.textContent="Klaar voor AI";
  }else if(state.room==="Woonkamer"||state.room==="Keuken"){
    el.previewCaption.textContent=state.camera==="Corridor"?"Zicht vanuit de corridor · basisconcept":"Alternatief zicht · basisconcept";el.renderStatus.textContent="Basisbeeld";
  }else{
    el.previewCaption.textContent="Voor deze testruimte is nog geen eigen basisbeeld gekoppeld";el.renderStatus.textContent="Binnenkort";
  }
}

function selectZone(button){
  el.zones.forEach(zone=>zone.classList.toggle("active",zone===button));
  state.zone=button.dataset.zone;state.room=button.dataset.room;
  el.selectedZone.textContent=state.zone;el.generationTarget.textContent=state.zone;el.previewRoom.textContent=isMasterSuite()?"Grote slaapkamer":state.room;
  el.roomTabs.forEach(tab=>tab.classList.toggle("active",tab.dataset.roomTab===state.room));
  el.cameras.forEach(camera=>camera.disabled=isMasterSuite());
  showRoomBase();renderPhotos();updateHint();
}

function setRoom(room){
  const matchingZone=room==="Slaapkamer"?el.zones.find(zone=>zone.dataset.zone==="Master suite"):el.zones.find(zone=>zone.dataset.room===room);
  if(matchingZone){selectZone(matchingZone);return}
  state.room=room;el.roomTabs.forEach(tab=>tab.classList.toggle("active",tab.dataset.roomTab===room));el.previewRoom.textContent=room;showRoomBase();updateHint();
}

function updateHint(){
  const photos=zonePhotos();
  if(!isMasterSuite()){
    el.generateButton.disabled=true;el.generationHint.textContent="De eerste werkende AI-test is beschikbaar via de zone ‘Master suite’.";return;
  }
  el.generateButton.disabled=false;
  if(!photos.length){el.generationHint.textContent="Voeg één of meer kleur- of materiaalbeelden toe voor de grote slaapkamer.";return}
  const note=el.ideaText.value.trim();el.generationHint.textContent=`${photos.length} referentie${photos.length===1?"":"s"} gekoppeld aan de grote slaapkamer${note?" · instructie klaar":" · beschrijf nog wat ermee moet gebeuren"}.`;
}

function renderPhotos(){
  const photos=zonePhotos();el.photoCount.textContent=photos.length;
  if(!photos.length){el.photoGrid.innerHTML='<div class="empty-library"><span>✦</span><p>Referenties voor deze zone verschijnen hier.</p></div>';updateHint();return}
  el.photoGrid.innerHTML="";
  photos.forEach(photo=>{
    const item=document.createElement("div");item.className="photo-item";
    const image=document.createElement("img");image.src=photo.url;image.alt=`Inspiratie voor ${photo.zone}`;
    const label=document.createElement("small");label.textContent=photo.name;
    const remove=document.createElement("button");remove.type="button";remove.setAttribute("aria-label",`Verwijder ${photo.name}`);remove.textContent="×";
    remove.addEventListener("click",()=>{const index=state.photos.indexOf(photo);URL.revokeObjectURL(photo.url);state.photos.splice(index,1);renderPhotos()});
    item.append(image,label,remove);el.photoGrid.append(item);
  });updateHint();
}

function addFiles(fileList){
  const images=[...fileList].filter(file=>file.type.startsWith("image/")&&file.size<=8*1024*1024);
  if(!images.length){showToast("Kies JPG-, PNG- of WEBP-beelden van maximaal 8 MB.");return}
  const remaining=Math.max(0,5-zonePhotos().length);
  images.slice(0,remaining).forEach(file=>state.photos.push({name:file.name,zone:state.zone,url:URL.createObjectURL(file),file}));
  renderPhotos();showToast(`${Math.min(images.length,remaining)} beeld${Math.min(images.length,remaining)===1?"":"en"} toegevoegd aan ${state.zone}`);
}

function startGenerating(){
  el.previewCard.classList.add("generating");el.renderStatus.textContent="AI genereert";el.generateButton.disabled=true;el.generationHint.textContent="De architectuur blijft behouden; kleur en materiaal worden nu echt toegepast…";
}

function stopGenerating(){el.previewCard.classList.remove("generating");el.generateButton.disabled=false;updateHint()}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error(`Kon ${file.name} niet lezen.`));reader.readAsDataURL(file)})}

async function generateLook(){
  if(!isMasterSuite()){showToast("Selecteer eerst de Master suite op de plattegrond.");return}
  const photos=zonePhotos(),instruction=el.ideaText.value.trim();
  if(!photos.length){el.dropzone.focus();showToast("Voeg eerst minstens één materiaal- of kleurbeeld toe.");return}
  if(!instruction){el.ideaText.focus();showToast("Beschrijf eerst waar en hoe het materiaal moet worden toegepast.");return}
  if(!state.accessToken){state.pendingGeneration=true;el.accessError.textContent="";el.accessDialog.showModal();setTimeout(()=>el.accessPassword.focus(),80);return}
  startGenerating();
  try{
    const references=await Promise.all(photos.map(async photo=>({name:photo.name,dataUrl:await fileToDataUrl(photo.file)})));
    const response=await fetch("/api/canvas/generate",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${state.accessToken}`},body:JSON.stringify({zone:state.zone,instruction,references})});
    const data=await response.json().catch(()=>({error:"De server gaf geen geldig antwoord."}));
    if(response.status===401){state.accessToken="";localStorage.removeItem("canvasAccessToken");state.pendingGeneration=true;stopGenerating();el.accessError.textContent="Je sessie is verlopen. Ontgrendel Canvas opnieuw.";el.accessDialog.showModal();setTimeout(()=>el.accessPassword.focus(),80);return}
    if(!response.ok)throw new Error(data.error||"De AI-bewerking kon niet worden gemaakt.");
    state.look+=1;el.previewImage.src=data.image_url;el.previewImage.alt=`AI-ontwerp ${state.look} voor de grote slaapkamer`;el.renderStatus.textContent=`AI-ontwerp ${String(state.look).padStart(2,"0")}`;el.previewCaption.textContent=`Grote slaapkamer · ${photos.length} materiaalreferentie${photos.length===1?"":"s"}`;el.generationHint.textContent="Dit is een echte AI-bewerking. Pas je instructie of referenties aan voor een volgende variant.";showToast("Het nieuwe slaapkamerbeeld is klaar");
  }catch(error){el.generationHint.textContent=error.message;showToast(error.message)}finally{el.previewCard.classList.remove("generating");if(!state.pendingGeneration)el.generateButton.disabled=false}
}

async function unlock(event){
  event.preventDefault();el.accessSubmit.disabled=true;el.accessError.textContent="";
  try{
    const response=await fetch("/api/canvas/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:el.accessPassword.value})});
    const data=await response.json().catch(()=>({error:"Inloggen mislukt."}));if(!response.ok)throw new Error(data.error||"Onjuist wachtwoord.");
    state.accessToken=data.token;localStorage.setItem("canvasAccessToken",data.token);el.accessPassword.value="";el.accessDialog.close();const retry=state.pendingGeneration;state.pendingGeneration=false;if(retry)await generateLook();
  }catch(error){el.accessError.textContent=error.message}finally{el.accessSubmit.disabled=false}
}

el.zones.forEach(button=>button.addEventListener("click",()=>selectZone(button)));
el.roomTabs.forEach(tab=>tab.addEventListener("click",()=>setRoom(tab.dataset.roomTab)));
el.cameras.forEach(camera=>camera.addEventListener("click",()=>{state.camera=camera.dataset.camera;el.cameras.forEach(item=>item.classList.toggle("active",item===camera));if(!isMasterSuite()){el.previewImage.style.transform=state.camera==="Tuinzijde"?"scale(1.08) translateX(-2%)":"";el.previewCaption.textContent=state.camera==="Corridor"?"Zicht vanuit de corridor · basisconcept":"Alternatief zicht · basisconcept"}}));
["dragenter","dragover"].forEach(name=>el.dropzone.addEventListener(name,event=>{event.preventDefault();el.dropzone.classList.add("dragging")}));
["dragleave","drop"].forEach(name=>el.dropzone.addEventListener(name,event=>{event.preventDefault();el.dropzone.classList.remove("dragging")}));
el.dropzone.addEventListener("drop",event=>addFiles(event.dataTransfer.files));
el.dropzone.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" ")el.fileInput.click()});
el.fileInput.addEventListener("change",event=>{addFiles(event.target.files);event.target.value=""});el.folderInput.addEventListener("change",event=>{addFiles(event.target.files);event.target.value=""});
el.ideaText.addEventListener("input",updateHint);el.generateButton.addEventListener("click",generateLook);el.accessForm.addEventListener("submit",unlock);el.accessClose.addEventListener("click",()=>{state.pendingGeneration=false;el.accessDialog.close()});
el.zoneMenuButton.addEventListener("click",()=>showToast("Klik direct op een zone in de plattegrond."));
el.resetButton.addEventListener("click",()=>{state.photos.forEach(photo=>URL.revokeObjectURL(photo.url));state.photos=[];state.look=0;state.pendingGeneration=false;el.ideaText.value="";selectZone(el.zones[0]);showToast("Nieuwe ontwerpsessie gestart")});
renderPhotos();showRoomBase();
