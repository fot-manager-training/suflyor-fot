import mammoth from 'mammoth/mammoth.browser.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
if(typeof window!=='undefined')pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
const MAX_FILE=25*1024*1024, MAX_TEXT=250000;
function validateText(value){
 const text=String(value||'').replace(/\u0000/g,'').replace(/\r\n?/g,'\n').trim();
 if(!text)throw new Error('В документе не найден текст. Для PDF-скана нужна версия с распознанным текстом.');
 if(text.length>MAX_TEXT)throw new Error('В документе больше 250 000 знаков. Разделите его на части.');
 return text;
}
export async function extractDocument(file,{onProgress=()=>{}}={}){
 if(!file)throw new Error('Выберите документ.');
 if(file.size>MAX_FILE)throw new Error('Документ больше 25 МБ. Разделите его на части.');
 const ext=String(file.name||'').split('.').pop().toLowerCase();
 onProgress({message:'Читаю '+(file.name||'документ'),progress:0});
 if(ext==='doc')throw new Error('Сохраните старый файл Word как .docx и загрузите снова.');
 if(ext==='docx'){
  try{
   const arrayBuffer=new Uint8Array(await file.arrayBuffer()).slice().buffer;
   const result=await mammoth.extractRawText({arrayBuffer});
   onProgress({message:'Текст Word извлечён',progress:100});return validateText(result.value);
  }catch(error){if(/250 000|не найден текст/.test(error.message))throw error;throw new Error('Не удалось открыть Word. Проверьте, что файл не повреждён и сохранён в формате .docx.');}
 }
 if(ext==='pdf'){
  let task,document;
  try{
   task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true,disableFontFace:true});
   document=await task.promise;
   if(document.numPages>300)throw new Error('В PDF больше 300 страниц. Разделите его на части.');
   const pages=[];let length=0;
   for(let i=1;i<=document.numPages;i++){
    const page=await document.getPage(i);const data=await page.getTextContent();
    const lines=[];let line='';
    for(const item of data.items){if(!('str' in item))continue;line+=item.str;if(item.hasEOL){lines.push(line);line='';}else line+=' ';}
    if(line.trim())lines.push(line);const text=lines.join('\n');length+=text.length;
    if(length>MAX_TEXT)throw new Error('В документе больше 250 000 знаков. Разделите его на части.');
    pages.push(text);page.cleanup();onProgress({message:`Читаю PDF: страница ${i} из ${document.numPages}`,progress:Math.round(i/document.numPages*100)});
   }
   return validateText(pages.join('\n\n'));
  }catch(error){
   if(error.name==='PasswordException')throw new Error('PDF защищён паролем. Загрузите незапароленную копию.');
   if(/250 000|300 страниц|не найден текст/.test(error.message))throw error;
   throw new Error('Не удалось прочитать PDF. Проверьте файл или сохраните документ в Word (.docx).');
  }finally{try{if(document)await document.destroy();else if(task)await task.destroy();}catch{}}
 }
 if(['txt','md','vtt','srt'].includes(ext)||file.type==='text/plain')return validateText(await file.text());
 throw new Error('Поддерживаются .docx, .pdf, .txt, .md, .vtt и .srt.');
}
