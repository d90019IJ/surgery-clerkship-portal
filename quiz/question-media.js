let dialog;
export function addQuestionImage(field, image) {
  if (!image || !/^data:image\/(?:jpeg|png|webp);base64,/.test(image.src)) return;
  const figure=document.createElement('figure');figure.className='question-image';
  const button=document.createElement('button');button.type='button';button.className='image-open';
  button.setAttribute('aria-label','放大題目影像');
  const img=document.createElement('img');img.src=image.src;img.alt=image.alt||'題目影像';img.loading='lazy';
  button.append(img);figure.append(button);
  const caption=document.createElement('figcaption');caption.textContent='點選圖片可放大，原始箭頭與編號保留。';figure.append(caption);field.append(figure);
  button.addEventListener('click',()=>showImage(image));
}
function showImage(image) {
  if(!dialog){
    dialog=document.createElement('dialog');dialog.className='image-dialog';
    dialog.innerHTML='<div class="image-tools"><button type="button" class="secondary" data-size>放大 2 倍</button><button type="button" class="primary" data-close>關閉圖片</button></div><div class="image-scroll"><img alt=""></div>';
    document.body.append(dialog);
    dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>dialog.querySelector('img').removeAttribute('src'));
    dialog.querySelector('[data-size]').addEventListener('click',()=>{
      const img=dialog.querySelector('img'),zoom=img.dataset.zoom!=='true';img.dataset.zoom=String(zoom);
      img.style.width=zoom?(img.naturalWidth*2)+'px':'';img.style.maxWidth=zoom?'none':'100%';
      dialog.querySelector('[data-size]').textContent=zoom?'符合畫面':'放大 2 倍';
    });
  }
  const img=dialog.querySelector('img');img.src=image.src;img.alt=image.alt||'題目影像';img.dataset.zoom='false';img.style.width='';img.style.maxWidth='100%';
  dialog.querySelector('[data-size]').textContent='放大 2 倍';dialog.showModal();
}
