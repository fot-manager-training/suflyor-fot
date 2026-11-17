import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFrontend} from './frontend-harness.mjs';
const bundle=JSON.parse(readFileSync(new URL('../suflyor/knowledge.json',import.meta.url),'utf8'));
const array=value=>Array.from(value);
test('sparse timestamp intervals distribute speaker words without alternating artificial zeroes',()=>{
 const f=createFrontend(()=>{}),line=Array(260).fill('слово').join(' ');
 const parsed=f.parseTranscript('Длительность: 4:00\n[00:00] '+line+'\n[02:00] '+line);
 const metrics=f.computeMetrics(parsed);
 assert.equal(metrics.words,520);assert.equal(metrics.wpm,130);assert.deepEqual(array(metrics.paceSeries),[130,130,130,130]);
 const dialogue=f.parseTranscript('Длительность: 3:00\n[00:00] '+line+'\n[02:00] Клиент: '+Array(100).fill('вопрос').join(' '));
 const m=f.computeMetrics(dialogue);assert.equal(m.words,260);assert.deepEqual(array(m.paceSeries),[130,130,0]);
 assert.deepEqual(array(f.paceByMinute([{t:100,text:line}],30)),[0]);
});
test('verdict follows thresholds and product errors regardless of a model label',()=>{
 const f=createFrontend(()=>{});
 assert.equal(f.computeVerdict(45,[]),'Нужна повторная подготовка');
 assert.equal(f.computeVerdict(85,[]),'Готов к клиенту');
 assert.equal(f.computeVerdict(85,[{status:'ошибка'}]),'Нужна доработка');
 assert.equal(f.computeVerdict(70,[{status:'недопустимое обещание'},{status:'ошибка'},{status:'ошибка'}]),'Нужна повторная подготовка');
 const findings=f.normFindings({facts:{claims:[]}}),metrics=f.computeMetrics(f.parseTranscript(f.DEMO));
 const report=f.finishReport('auto',{},metrics,findings,{verdict_label:'Готов к клиенту'},90,1,[]);
 assert.equal(report.final.verdict_label,report.scores.verdict);assert.equal(report.final.verdict_llm,'Готов к клиенту');assert.equal(report.analysisVersion,'2.1');
});
test('unknown facts do not reduce accuracy but create an explicit knowledge-gap warning',()=>{
 const f=createFrontend(()=>{}),known=Array(3).fill({status:'верно'}),unknown=Array(10).fill({status:'нет в базе'});
 const score=f.accuracyScore([...known,...unknown]);assert.equal(score.score,10);assert.equal(score.kbGap,true);assert.equal(score.notInKb,10);
 assert.equal(f.accuracyScore(unknown).score,4);assert.equal(f.accuracyScore([{status:'верно'},...unknown]).score,8);
 assert.equal(f.accuracyScore([...known,{status:'ошибка'}]).score,7.5);
});
test('audience must be explicit in both automatic and manual analysis',async()=>{
 let calls=0;const f=createFrontend(()=>{calls++;});assert.equal(f.newSession().audience,'');
 f.node('audience').value='';await f.runAuto();assert.equal(calls,0);assert.match(f.node('runNote').textContent,/Выберите аудиторию/);
 f.manualStart();assert.equal(f.App.cur.manual,null);
 const blocks=f.expectedBlocks('Коллектив сотрудников клиента');assert.equal(blocks.includes('Выгоды для компании'),false);assert.equal(blocks.includes('Как перейти: шаги для сотрудника'),true);
 assert.equal(f.expectedBlocks('КСБ').includes('Выгоды для компании'),true);
 const parsed=f.parseTranscript(f.DEMO),metrics=f.computeMetrics(parsed),ctx={audience:'Коллектив сотрудников клиента'};
 assert.doesNotMatch(f.pStructure(ctx,metrics,parsed.text),/Выгоды для компании/);
 assert.match(f.pFacts(ctx,metrics,'630 в месяц, 8000 в год'),/×12/);
});
test('PII masks preserve product numbers and are consistent with quote checks',()=>{
 const f=createFrontend(()=>{});
 const raw='Заявление несите в кабинет 26, Катерина Викторовна, тел. +7 (921) 123-45-67, почта hr@firm.ru. До 10%, 300 000 ₽, 185 000 бонусов.';
 const masked=f.maskPII(raw);assert.doesNotMatch(masked,/Викторовна|123-45-67|hr@firm/);assert.match(masked,/кабинет \[№\]/);assert.match(masked,/\[имя\]/);assert.match(masked,/До 10%, 300 000 ₽, 185 000 бонусов/);
 f.App.cur.transcript=raw;const input=f.prepareInput();assert.equal(f.App.cur.transcript,raw);assert.equal(input.text,masked);assert.equal(f.computeMetrics(input).words,f.computeMetrics(f.parseTranscript(raw)).words);
 const qc=f.quoteCheck(f.normFindings({facts:{claims:[{quote:'в кабинет [№]',status:'верно'}]}}),input.text);assert.equal(qc.coverage,1);
});
test('new bases replace managed legacy text exactly once and retain custom additions',async()=>{
 const f=createFrontend(()=>{}),legacy=bundle.legacy;
 const make=target=>legacy.bases[target]+legacy.documents.filter(d=>d.target===target).map(d=>'\n\n=== ИСТОЧНИК: '+d.id+' ===\n'+d.title+'\n'+d.text).join('');
 const old=make('zp');f.App.kbZp=old+'\n\n=== ДОПОЛНЕНИЕ: Моё правило ===\nМой текст';f.App.kbSp=make('sp');f.Knowledge.version='2026-11-13.1';
 f.applyKnowledgeBundle(bundle);const once=f.App.kbZp;assert.match(once,/версия 1\.1/);assert.match(once,/Мой текст/);assert.doesNotMatch(once,/ИСТОЧНИК: salary-project/);
 assert.equal(f.Knowledge.pendingBackup.zp,old+'\n\n=== ДОПОЛНЕНИЕ: Моё правило ===\nМой текст');
 f.applyKnowledgeBundle(bundle);assert.equal(f.App.kbZp,once);assert.doesNotMatch(f.App.kbSp,/− 0,5/);assert.match(f.App.kbSp,/статус «нет в базе» не снижает балл/);
});
test('all outbound API prompts mask PII in transcript, context and custom knowledge',async()=>{
 const sent=[];const f=createFrontend(async(path,options)=>{
  if(path==='/api/status')return Response.json({authorized:true,configured:true});
  const prompt=JSON.parse(options.body).prompt;sent.push(prompt);assert.doesNotMatch(prompt,/Викторовна|hr@firm\.ru|123-45-67/);
  let data={summary:'Итог',top_strengths:[],growth:[],rewrites:[]};
  if(prompt.includes('ЗАДАЧА: разбери структуру'))data={blocks:[],key_message:'ЗП'};
  else if(prompt.includes('ЗАДАЧА: сверь выступление'))data={claims:[],missed:[]};
  else if(prompt.includes('ЗАДАЧА: оцени выступление'))data={criteria:[],strengths:[],weaknesses:[]};
  else if(prompt.includes('ЗАДАЧА: ты — независимый'))data={issues:[],confidence:{structure:96,facts:96,rubric:96},overall:96};
  return Response.json({choices:[{message:{content:JSON.stringify(data)}}]});
 });
 f.App.cur.transcript=f.DEMO+' Катерина Викторовна, hr@firm.ru';f.node('goal').value='Позвонить +7 (921) 123-45-67';f.App.kbZp+='\nКонтакт hr@firm.ru';
 await f.runAuto();assert.ok(f.App.cur.report);assert.equal(sent.length,5);assert.match(sent[0],/\[имя\]/);
});
