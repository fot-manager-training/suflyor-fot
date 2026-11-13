import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {extractDocument} from '../suflyor/document-reader.mjs';
const fixture=(name,type)=>new File([readFileSync(new URL('./fixtures/'+name,import.meta.url))],name,{type});
test('Word text is extracted as paragraphs, not ZIP bytes or HTML',async()=>{
 const text=await extractDocument(fixture('meeting.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
 assert.match(text,/Добрый день, коллеги/);assert.match(text,/Следующий шаг/);assert.equal(text.includes('PK\u0003'),false);
});
test('PDF text is extracted from every page with progress',async()=>{
 const progress=[];const text=await extractDocument(fixture('meeting.pdf','application/pdf'),{onProgress:p=>progress.push(p)});
 assert.match(text,/Добрый день/);assert.match(text,/Следующий шаг/);assert.equal(progress.at(-1).progress,100);assert.match(progress.at(-1).message,/2 из 2/);
});
test('PDF without a text layer fails explicitly instead of replacing the transcript',async()=>{
 await assert.rejects(extractDocument(fixture('blank.pdf','application/pdf')),/не найден текст/);
 await assert.rejects(extractDocument(new File(['broken'],'broken.docx')),/Не удалось открыть Word/);
 await assert.rejects(extractDocument(new File(['old'],'old.doc')),/сохраните|Сохраните/);
});

test('built browser bundle extracts Word even when the file originates in another realm',async()=>{
 const source=readFileSync(new URL('../dist/server/index.js',import.meta.url),'utf8');const assets=JSON.parse(source.slice(13,source.indexOf(';\n')));
 const dom=new JSDOM('<!doctype html><p>test</p>',{url:'https://example.test',runScripts:'outside-only'});
 const w=dom.window;Object.assign(w,{DOMMatrix:globalThis.DOMMatrix,ImageData:globalThis.ImageData,Path2D:globalThis.Path2D,TextDecoder,TextEncoder,ReadableStream,Blob,File,structuredClone,Response,Request,Headers});
 try{w.eval(assets['/document-reader.js'].body);const bytes=readFileSync(new URL('./fixtures/meeting.docx',import.meta.url));const text=await w.SuflyorDocs.extractDocument(new File([bytes],'meeting.docx'));assert.match(text,/Добрый день/);}finally{w.close();}
});
