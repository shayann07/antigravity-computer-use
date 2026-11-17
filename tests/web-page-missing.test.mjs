import test from 'node:test';import assert from 'node:assert/strict';
import {renderSnapshot,webPageMissingNote} from '../server/render.mjs';

const frame=[{i:0,depth:0,role:'Window',name:'Example Domain'},{i:2,depth:1,role:'Pane',name:'Example Domain - Personal'},{i:7,depth:2,role:'Button',name:'Minimize'}];

test('a browser window whose page was never built says to bring it forward',()=>{
 const out=renderSnapshot({snapshot_id:'s1',title:'Example Domain',hwnd:5,web:true,web_page_missing:true,nodes:frame});
 assert.match(out.split('\n')[0],/PAGE NOT EXPOSED YET: .*computer_focus \{ hwnd \} and observe again/);
});

test('no note without the native flag, or for a window on another desktop',()=>{
 assert.equal(webPageMissingNote({web:true,nodes:frame}),'');
 assert.equal(webPageMissingNote({web:true,web_page_missing:true,other_desktop:true}),'');
 assert.doesNotMatch(renderSnapshot({snapshot_id:'s2',title:'x',hwnd:5,web:true,nodes:frame}),/PAGE NOT EXPOSED/);
});
