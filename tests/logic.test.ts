import{describe,it,expect}from'vitest';import{compare,parseCollection,parseDeck}from'../src/logic';
const csv=(qty:string,code='OGN-046',name='준비 태세')=>`${code},${name},OGN,common,KR,${qty},,`;
describe('Riftbound quantity comparison',()=>{
it('A: calculates 3 needed, 2 owned, 1 missing',()=>{const o=parseCollection(csv('2')),d=parseDeck('OGN-046-1 OGN-046-1 OGN-046-1'),r=compare(o.cards,d)[0];expect([r.needed,r.owned,r.missing]).toEqual([3,2,1])});
it('B: caps missing at zero',()=>expect(compare(parseCollection(csv('5')).cards,parseDeck('OGN-046-1 OGN-046-1 OGN-046-1'))[0].missing).toBe(0));
it('C: treats absent valid code as zero owned',()=>expect(compare(new Map(),parseDeck('OGN-046-1'))[0]).toMatchObject({owned:0,needed:1,missing:1}));
it('D: keeps distinct codes separate even with identical names',()=>{const o=parseCollection(`${csv('2','OGN-046','Same')}\n${csv('1','OGN-047','Same')}`);expect(o.cards.size).toBe(2)});
it('E: normalizes print variants and counts each token',()=>expect(parseDeck('OGN-046-1 OGN-046-2').counts.get('OGN-046')).toBe(2));
it('F: aggregates duplicate collection rows',()=>expect(parseCollection(`${csv('2')}\n${csv('3')}`).cards.get('OGN-046')?.qty).toBe(5));
it('G: reports empty, invalid CSV quantities and invalid TTS',()=>{expect(parseDeck('').errors.length).toBeGreaterThan(0);expect(parseCollection(csv('-1')).errors.length).toBe(1);expect(parseDeck('garbage').errors.length).toBe(1)});
it('parses quoted commas and header columns',()=>{const p=parseCollection('Name,Code,Qty\n"둘, 셋",OGN-046,2');expect(p.cards.get('OGN-046')?.name).toBe('둘, 셋')});
});

