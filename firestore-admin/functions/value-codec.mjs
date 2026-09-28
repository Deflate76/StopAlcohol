// Shared by the browser editor and server. Firestore wire types remain lossless.
export const TYPE_LABELS = {
  stringValue:'문자열', integerValue:'정수', doubleValue:'실수', booleanValue:'참/거짓',
  nullValue:'null', timestampValue:'날짜·시각', mapValue:'객체', arrayValue:'배열',
  referenceValue:'문서 참조', geoPointValue:'위치', bytesValue:'바이너리'
};
export const byteLength = value => new TextEncoder().encode(value).length;
export const plain = value => !!value && typeof value==='object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null);
export function pathParts(path,kind='document',allowRoot=false) {
  if(typeof path!=='string' || byteLength(path)>6000)throw new Error('경로 형식을 확인해 주세요.');
  if(path==='' && allowRoot)return [];
  const parts=path.split('/');
  if(!parts.length || parts.length>200 || parts.some(p=>!p || p==='.' || p==='..' || /[\u0000-\u001f\u007f]/.test(p) || byteLength(p)>1500))
    throw new Error('경로의 빈 이름, 제어문자 또는 길이를 확인해 주세요.');
  if((parts.length%2===0)!==(kind==='document'))throw new Error(kind==='document'?'문서 경로는 컬렉션/문서ID 순서로 입력하세요.':'컬렉션 경로를 입력하세요.');
  return parts;
}
export function validTimestamp(value) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(value))return false;
  if(value.slice(0,4)==='0000')return false;
  const date=new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,19)===value.slice(0,19);
}
export function validateValue(value,depth=0,budget={count:0},insideArray=false) {
  if(depth>20 || ++budget.count>12000)throw new Error('중첩 깊이 또는 필드 수가 편집 한도를 초과했습니다.');
  if(!plain(value) || Object.keys(value).length!==1)throw new Error('각 값에는 Firestore 타입 키가 하나만 있어야 합니다.');
  const type=Object.keys(value)[0],v=value[type];
  if(!Object.hasOwn(TYPE_LABELS,type))throw new Error('지원하지 않는 Firestore 데이터 타입입니다.');
  switch(type) {
    case 'stringValue': if(typeof v!=='string')throw new Error('문자열 값을 입력하세요.');break;
    case 'integerValue':
      if(typeof v!=='string' || !/^-?(0|[1-9]\d*)$/.test(v) || v.length>20 || BigInt(v)<-9223372036854775808n || BigInt(v)>9223372036854775807n)
        throw new Error('정수는 64비트 범위의 숫자 문자열로 입력하세요.');
      break;
    case 'doubleValue':
      if(!(typeof v==='number' && Number.isFinite(v)) && !['NaN','Infinity','-Infinity'].includes(v))throw new Error('실수 값을 확인하세요.');
      break;
    case 'booleanValue': if(typeof v!=='boolean')throw new Error('true 또는 false를 입력하세요.');break;
    case 'nullValue': if(v!==null && v!=='NULL_VALUE')throw new Error('null 값을 확인하세요.');break;
    case 'timestampValue': if(!validTimestamp(v))throw new Error('날짜는 UTC 형식으로 입력하세요. 예: 2026-09-27T04:00:00Z');break;
    case 'bytesValue':
      if(typeof v!=='string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v))throw new Error('바이너리는 Base64 형식으로 입력하세요.');
      break;
    case 'referenceValue':
      if(typeof v!=='string' || !/^projects\/[^/]+\/databases\/[^/]+\/documents\//.test(v))throw new Error('문서 참조의 전체 경로를 입력하세요.');
      pathParts(v.split('/documents/').slice(1).join('/documents/'));break;
    case 'geoPointValue':
      if(!plain(v) || Object.keys(v).some(k=>!['latitude','longitude'].includes(k)) || !Number.isFinite(v.latitude) || !Number.isFinite(v.longitude) || Math.abs(v.latitude)>90 || Math.abs(v.longitude)>180)
        throw new Error('위도(-90~90)와 경도(-180~180)를 확인하세요.');
      break;
    case 'mapValue':
      if(!plain(v) || Object.keys(v).some(k=>k!=='fields') || (v.fields!==undefined&&!plain(v.fields)))throw new Error('객체는 fields를 포함하는 형식으로 입력하세요.');
      validateFields(v.fields||{},depth+1,budget,false);break;
    case 'arrayValue':
      if(insideArray || !plain(v) || Object.keys(v).some(k=>k!=='values') || (v.values!==undefined && !Array.isArray(v.values)))throw new Error('배열 형식을 확인하세요. 배열 안에 배열을 직접 넣을 수 없습니다.');
      for(const item of v.values||[])validateValue(item,depth+1,budget,true);break;
  }
  return value;
}
export function validateFields(fields,depth=0,budget={count:0},checkSize=true) {
  if(!plain(fields))throw new Error('필드는 JSON 객체여야 합니다.');
  for(const [key,value] of Object.entries(fields)) {
    if(!key || byteLength(key)>1500 || /[\u0000-\u001f\u007f]/.test(key))throw new Error('필드 이름이 비어 있거나 너무 깁니다.');
    validateValue(value,depth,budget);
  }
  if(checkSize && byteLength(JSON.stringify(fields))>900000)throw new Error('이 편집기에서는 900KB 이하의 문서를 저장할 수 있습니다.');
  return fields;
}
export function valueText(value) {
  const type=Object.keys(value||{})[0],v=value?.[type];
  if(type==='mapValue')return JSON.stringify(v.fields||{},null,2);
  if(type==='arrayValue')return JSON.stringify(v.values||[],null,2);
  if(type==='geoPointValue')return JSON.stringify(v,null,2);
  if(type==='nullValue')return 'null';
  return typeof v==='string'?v:JSON.stringify(v);
}
export function parseValue(type,text) {
  let value;
  if(['stringValue','integerValue','timestampValue','referenceValue','bytesValue'].includes(type))value={[type]:type==='stringValue'?text:text.trim()};
  else if(type==='mapValue')value={mapValue:{fields:JSON.parse(text)}};
  else if(type==='arrayValue')value={arrayValue:{values:JSON.parse(text)}};
  else if(type==='nullValue')value={nullValue:null};
  else if(type==='doubleValue' && ['NaN','Infinity','-Infinity'].includes(text.trim()))value={doubleValue:text.trim()};
  else value={[type]:JSON.parse(text)};
  return validateValue(value);
}
export function summaryValue(value,max=120) {
  const type=Object.keys(value||{})[0],v=value?.[type];
  let result=type==='mapValue'?'객체 · '+Object.keys(v.fields||{}).length+'개 필드':
    type==='arrayValue'?'배열 · '+(v.values||[]).length+'개':
    type==='bytesValue'?'Base64 · '+v.length+'자':String(valueText(value)??'');
  return result.length>max?result.slice(0,max)+'…':result;
}
export function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(plain(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function diffFields(before={},after={}) {
  return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(key=>canonical(before[key])!==canonical(after[key])).map(key=>({
    key,kind:!Object.hasOwn(after,key)?'delete':!Object.hasOwn(before,key)?'add':'change',before:before[key],after:after[key]
  }));
}

// Expand edits inside arrays/maps so the final confirmation shows actual values.
export function diffEntries(before={},after={},limit=100) {
  const changes=[];let total=0;
  const add=(key,a,b)=>{total++;if(changes.length<limit)changes.push({key,kind:a===undefined?'add':b===undefined?'delete':'change',before:a,after:b});};
  function visit(a,b,path) {
    if(canonical(a)===canonical(b))return;
    const ta=Object.keys(a||{})[0],tb=Object.keys(b||{})[0];
    if((!a||ta==='mapValue')&&(!b||tb==='mapValue')){
      const fa=a?.mapValue.fields||{},fb=b?.mapValue.fields||{},keys=[...new Set([...Object.keys(fa),...Object.keys(fb)])];
      if(!keys.length){add(path,a,b);return;}
      for(const key of keys)visit(Object.hasOwn(fa,key)?fa[key]:undefined,Object.hasOwn(fb,key)?fb[key]:undefined,path+'['+JSON.stringify(key)+']');
    }else if((!a||ta==='arrayValue')&&(!b||tb==='arrayValue')){
      const va=a?.arrayValue.values||[],vb=b?.arrayValue.values||[];
      if(!va.length&&!vb.length){add(path,a,b);return;}
      for(let i=0;i<Math.max(va.length,vb.length);i++)visit(va[i],vb[i],path+'['+i+']');
    }else add(path,a,b);
  }
  for(const key of new Set([...Object.keys(before),...Object.keys(after)]))visit(Object.hasOwn(before,key)?before[key]:undefined,Object.hasOwn(after,key)?after[key]:undefined,key);
  return {changes,total};
}
