import { readFileSync } from 'node:fs'
const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const i=t.indexOf('='); if(i<0)continue
  env[t.slice(0,i).trim()]=t.slice(i+1).trim()
}
const post=async(path,b)=>{const r=await fetch(env.CLEANVERSE_COOPERATE_BASE+'/'+path,{method:'POST',headers:{'Content-Type':'application/json','api-id':env.CLEANVERSE_APP_ID},body:JSON.stringify(b)});return await r.json()}
console.log('MONAD institution whitelist:', JSON.stringify((await post('query_institution_white_list',{chain:'monad'})).data))
console.log('MONAD supported atoken list:', JSON.stringify((await post('query_deposit_atoken_list',{chain:'monad'})).data))
