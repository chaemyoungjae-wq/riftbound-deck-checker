import Papa from 'papaparse';
export type Owned = {code:string; name:string; qty:number};
export type Deck = {counts:Map<string,number>; tokens:number; errors:string[]};
const CODE=/^[A-Z]{2,4}-\d{3}$/;
export function parseCollection(text:string):{cards:Map<string,Owned>; total:number; errors:string[]}{
 const parsed=Papa.parse<string[]>(text.replace(/^\uFEFF/,''),{skipEmptyLines:'greedy'}); const rows=parsed.data; const cards=new Map<string,Owned>(),errors:string[]=parsed.errors.map(e=>`CSV 형식 오류: ${e.message}`);
 let start=0; const h=(rows[0]||[]).map(x=>String(x).trim().toLowerCase());
 if(h.some(x=>x==='code')&&h.some(x=>x==='qty')) start=1;
 const ci=start? h.indexOf('code'):0, qi=start?h.indexOf('qty'):5, ni=start?h.indexOf('name'):1;
 for(let i=start;i<rows.length;i++){const row=rows[i]||[], line=i+1, code=String(row[ci]??'').trim().toUpperCase(), name=String(row[ni]??'').trim(), raw=String(row[qi]??'').trim();
  if(!code){errors.push(`행 ${line}: 카드 코드가 없습니다.`);continue;} if(!CODE.test(code)){errors.push(`행 ${line}: 카드 코드 형식이 올바르지 않습니다 (${code}).`);continue;}
  if(!/^\d+$/.test(raw)){errors.push(`행 ${line}: 수량은 0 이상의 정수여야 합니다.`);continue;} const qty=Number(raw), prior=cards.get(code);cards.set(code,{code,name:name||prior?.name||'',qty:qty+(prior?.qty||0)});
 } return {cards,total:[...cards.values()].reduce((n,c)=>n+c.qty,0),errors};
}
export function parseDeck(text:string):Deck{const counts=new Map<string,number>(),errors:string[]=[];let tokens=0;const parts=text.trim()?text.trim().split(/\s+/):[];
 for(const p of parts){const m=/^([A-Z]{2,4}-\d{3})-(\d+)$/.exec(p.toUpperCase());if(!m||Number(m[2])<1){errors.push(`인식하지 못한 토큰: ${p}`);continue;} const code=m[1];counts.set(code,(counts.get(code)||0)+1);tokens++;}
 if(!text.trim())errors.push('덱 TTS 코드가 비어 있습니다.');return {counts,tokens,errors};}
export function compare(cards:Map<string,Owned>,deck:Deck){return [...deck.counts].map(([code,needed])=>({code,name:cards.get(code)?.name||'이름 정보 없음',needed,owned:cards.get(code)?.qty||0,missing:Math.max(0,needed-(cards.get(code)?.qty||0))}));}
