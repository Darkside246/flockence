import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../app/poultry-refinement.css',import.meta.url),'utf8');
const base=readFileSync(new URL('../app/theme-system.css',import.meta.url),'utf8').split('html[data-theme="crystal"]')[0];
const colors=Object.fromEntries([...((base+'\n'+css).matchAll(/--([\w-]+): #(\w{6});/g))].map(([,key,value])=>[key,value]));
const luminance=hex=>hex.match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>{const [hi,lo]=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (hi+.05)/(lo+.05)};
for(const surface of ['bg-canvas','bg-surface','bg-surface-secondary','bg-surface-elevated','accent-soft','accent-soft-gold']) {
 test('Poultry Farm text and controls on '+surface,()=>{
  for(const key of ['text-primary','text-secondary','text-muted','text-heading','accent-primary','status-info']) assert.ok(ratio(colors[key],colors[surface])>=4.5,key+' '+surface+' '+ratio(colors[key],colors[surface]));
  for(const key of ['border-strong','border-focus']) assert.ok(ratio(colors[key],colors[surface])>=3,key+' '+surface);
 });
}
test('Poultry Farm chart marks remain visible on cards',()=>{
 for(const key of ['chart-green','chart-sage','chart-gold','chart-neutral']) assert.ok(ratio(colors[key],colors['bg-surface'])>=3,key);
});
test('Poultry Farm compatibility sheet cannot match another theme',()=>{
 // Every rule has an explicit Poultry Farm ancestor; media queries contain scoped rules only.
 for(const selector of css.matchAll(/(?:^|\})\s*([^{}]+)\{/g)) {
  const value=selector[1].trim();
  if(value.startsWith('/*')||value.startsWith('@')) continue;
  assert.ok(value.startsWith('html[data-theme="poultry"]'),value);
 }
 assert.ok(!/html\[data-theme="(?:crystal|aero|heritage|workhorse|sol|terra)"\]/.test(css));
});
