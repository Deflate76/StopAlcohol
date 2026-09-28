import {TYPE_LABELS,parseValue,valueText,validateValue} from './functions/value-codec.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const complex = value => !!value && (Object.hasOwn(value,'mapValue') || Object.hasOwn(value,'arrayValue'));
const put = (object,key,value) => Object.defineProperty(object,key,{value,writable:true,enumerable:true,configurable:true});
const defaultText = {stringValue:'',integerValue:'0',doubleValue:'0',booleanValue:'false',nullValue:'null',
  timestampValue:'2026-01-01T00:00:00Z',mapValue:'{}',arrayValue:'[]',
  referenceValue:'projects/alcoholaway/databases/(default)/documents/collection/document',
  geoPointValue:'{"latitude":0,"longitude":0}',bytesValue:''};
const initial = type => parseValue(type,defaultText[type]);
const PAGE_SIZE = 25;

function valueAt(value,path) {
  for(const key of path) value = typeof key === 'number' ? value.arrayValue.values[key] : value.mapValue.fields[key];
  return value;
}
function replaceAt(value,path,next) {
  const parent=valueAt(value,path.slice(0,-1)),key=path.at(-1);
  if(typeof key==='number')parent.arrayValue.values[key]=next;
  else put(parent.mapValue.fields,key,next);
}

export function mountValueGrid(document) {
  const $=id=>document.getElementById(id),dialog=$('gridDialog');
  let state=null;
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const button=(text,action,cls='small')=>{const node=el('button',text,cls);node.type='button';node.addEventListener('click',action);return node;};
  function error(message){$('gridError').textContent=message;$('gridError').hidden=!message;}
  function guard(){
    const pending=$('gridContent').querySelector('[data-pending-key]');
    if(pending)pending.dispatchEvent(new document.defaultView.Event('change',{bubbles:true}));
    const invalid=$('gridContent').querySelector('[aria-invalid="true"]');
    if(invalid){error('표의 잘못된 입력을 수정해 주세요. 전체 표 편집을 취소할 수도 있습니다.');invalid.focus();return false;}
    return true;
  }
  function change(action,renderAfter=true){
    if(!state||state.readOnly)return false;
    try{
      const next=copy(state.value);action(next);validateValue(next);
      state.value=next;state.onChange(copy(next));error('');
      if(renderAfter)render();
      return true;
    }catch(e){error(e.message);return false;}
  }
  function navigate(path){
    if(!state||!guard())return;
    state.path=path;state.page=0;render();
  }
  function typeSelect(value,label,{arrayItem=false}={}){
    const select=el('select');select.className='grid-type';select.setAttribute('aria-label',label+' 타입');
    for(const [type,name] of Object.entries(TYPE_LABELS)){
      if(arrayItem&&type==='arrayValue')continue;
      const option=el('option',name);option.value=type;select.append(option);
    }
    select.value=Object.keys(value)[0];select.disabled=state.readOnly;return select;
  }
  function editor(value,path,label,{arrayItem=false}={}){
    const cell=el('div',undefined,'grid-cell');
    const type=Object.keys(value)[0],select=typeSelect(value,label,{arrayItem});
    select.addEventListener('change',()=>{
      if(!guard()){select.value=type;return;}
      change(root=>replaceAt(root,path,initial(select.value)));
    });
    cell.append(select);
    if(complex(value)){
      const size=type==='arrayValue'?(value.arrayValue.values||[]).length:Object.keys(value.mapValue.fields||{}).length;
      const open=button(TYPE_LABELS[type]+' · '+size+'개 · 열기',()=>navigate(path),'grid-open');
      open.setAttribute('aria-label',label+' 하위 '+TYPE_LABELS[type]+' 열기');cell.append(open);
      return cell;
    }
    if(type==='nullValue'){cell.append(el('span','null','grid-null'));return cell;}
    if(type==='geoPointValue'){
      for(const key of ['latitude','longitude']){
        const labelNode=el('label',key==='latitude'?'위도':'경도'),input=el('input');
        input.value=String(value.geoPointValue[key]);input.disabled=state.readOnly;input.inputMode='decimal';
        input.addEventListener('input',()=>{
          const ok=change(root=>{
            if(!input.value.trim())throw new Error('위도와 경도에 숫자를 입력하세요.');
            valueAt(root,path).geoPointValue[key]=Number(input.value);
          },false);
          input.setAttribute('aria-invalid',String(!ok));
        });
        labelNode.append(input);cell.append(labelNode);
      }
      return cell;
    }
    const input=type==='booleanValue'?el('select'):el('textarea');
    if(type==='booleanValue'){
      for(const [v,labelText] of [['true','참 (true)'],['false','거짓 (false)']]){
        const option=el('option',labelText);option.value=v;input.append(option);
      }
    }else{
      input.rows=type==='stringValue'?2:1;input.spellcheck=false;
      if(type==='integerValue'||type==='doubleValue')input.inputMode='decimal';
      if(type==='timestampValue')input.placeholder='2026-09-28T00:00:00.123456789Z';
    }
    input.className='grid-value';input.value=valueText(value);input.disabled=state.readOnly;
    input.setAttribute('aria-label',label+' 값');
    input.addEventListener(type==='booleanValue'?'change':'input',()=>{
      const ok=change(root=>replaceAt(root,path,parseValue(type,input.value)),false);
      input.setAttribute('aria-invalid',String(!ok));
    });
    cell.append(input);return cell;
  }
  function removeButton(label,action){
    const node=button('삭제',()=>{if(guard())change(action);},'small danger');
    node.setAttribute('aria-label',label+' 삭제');node.disabled=state.readOnly;return node;
  }
  function header(table,labels){
    const head=el('thead'),row=el('tr');
    for(const text of labels){const th=el('th',text);th.scope='col';row.append(th);}
    head.append(row);table.append(head);
    const body=el('tbody');table.append(body);return body;
  }
  function blankRow(template){
    const fields=Object.create(null);
    for(const [key,value] of Object.entries(template?.mapValue?.fields||{}))put(fields,key,initial(Object.keys(value)[0]));
    return {mapValue:{fields}};
  }
  function render(){
    if(!state)return;
    $('gridContent').replaceChildren();$('gridBreadcrumbs').replaceChildren();$('gridTools').replaceChildren();
    $('gridBreadcrumbs').append(button(state.title,()=>navigate([])));
    for(let i=0;i<state.path.length;i++){
      const key=state.path[i];$('gridBreadcrumbs').append(el('span','/'),button(typeof key==='number'?'['+key+']':key,()=>navigate(state.path.slice(0,i+1))));
    }
    const value=valueAt(state.value,state.path),isArray=Object.hasOwn(value,'arrayValue');
    const items=isArray?(value.arrayValue.values||[]):Object.entries(value.mapValue.fields||{});
    const matrix=isArray&&items.length>0&&items.every(item=>Object.hasOwn(item,'mapValue'));
    const keys=matrix?[...new Set(items.flatMap(item=>Object.keys(item.mapValue.fields||{})))]:[];
    const total=items.length;state.page=Math.min(state.page,Math.max(0,Math.ceil(total/PAGE_SIZE)-1));
    const offset=state.page*PAGE_SIZE,table=el('table',undefined,'value-grid');
    table.setAttribute('aria-label',state.title+' 편집 표');
    const body=header(table,matrix?['행',...keys,'행 작업']:isArray?['순서','타입 · 값','작업']:['필드 이름','타입 · 값','작업']);
    items.slice(offset,offset+PAGE_SIZE).forEach((item,localIndex)=>{
      const index=offset+localIndex,row=el('tr');row.dataset.rowIndex=String(index);
      if(matrix){
        row.append(el('th',String(index+1)));
        for(const key of keys){
          const td=el('td');td.dataset.field=key;
          const fields=item.mapValue.fields||{},path=[...state.path,index,key];
          if(Object.hasOwn(fields,key))td.append(editor(fields[key],path,'행 '+(index+1)+' '+key));
          else{
            const add=button('필드 없음 · 추가',()=>{if(guard())change(root=>{
              const map=valueAt(root,[...state.path,index]).mapValue;map.fields??={};put(map.fields,key,initial('stringValue'));
            });});
            add.disabled=state.readOnly;td.append(add);
          }
          row.append(td);
        }
        const actions=el('td',undefined,'grid-row-actions');
        actions.append(button('행 편집',()=>navigate([...state.path,index])),removeButton('행 '+(index+1),root=>valueAt(root,state.path).arrayValue.values.splice(index,1)));
        row.append(actions);
      }else{
        const nameCell=el('td'),valueCell=el('td'),actions=el('td');
        const key=isArray?index:item[0],entry=isArray?item:item[1],path=[...state.path,key];
        if(isArray)nameCell.textContent=String(index+1);
        else{
          const input=el('input');input.className='grid-key';input.value=key;input.disabled=state.readOnly;input.setAttribute('aria-label',key+' 필드 이름');
          input.addEventListener('change',()=>{
            input.removeAttribute('data-pending-key');
            if(!guard())return;
            const ok=change(root=>{
              const fields=valueAt(root,state.path).mapValue.fields,newKey=input.value;
              if(newKey===key)return;
              if(Object.hasOwn(fields,newKey))throw new Error('같은 이름의 필드가 있습니다: '+newKey);
              put(fields,newKey,fields[key]);delete fields[key];
            });
            if(!ok)input.setAttribute('aria-invalid','true');
          });
          // Allow correcting an invalid name before its next change event.
          input.addEventListener('input',()=>{input.removeAttribute('aria-invalid');input.setAttribute('data-pending-key','true');});
          nameCell.append(input);
        }
        valueCell.append(editor(entry,path,isArray?'행 '+(index+1):key,{arrayItem:isArray}));
        actions.append(removeButton(isArray?'행 '+(index+1):key,root=>{
          const node=valueAt(root,state.path);if(isArray)node.arrayValue.values.splice(index,1);else delete node.mapValue.fields[key];
        }));
        row.append(nameCell,valueCell,actions);
      }
      body.append(row);
    });
    if(!total){const row=el('tr'),cell=el('td','아직 항목이 없습니다. 아래에서 추가하세요.','empty');cell.colSpan=3;row.append(cell);body.append(row);}
    if(matrix&&!keys.length){const caption=el('caption','행 편집을 눌러 필드를 추가하거나 아래에서 모든 행에 공통 필드를 추가하세요.');table.prepend(caption);}
    $('gridContent').append(table);
    const previous=button('이전 행',()=>{if(guard()){state.page--;render();}});
    const next=button('다음 행',()=>{if(guard()){state.page++;render();}});
    previous.disabled=state.page===0;next.disabled=offset+PAGE_SIZE>=total;
    const pager=el('div',undefined,'grid-pagination');
    pager.append(previous,el('span',total+'개 중 '+(total?offset+1:0)+'–'+Math.min(offset+PAGE_SIZE,total)+' 표시'),next);
    $('gridTools').append(pager);
    if(!state.readOnly){
      const addBar=el('div',undefined,'grid-add-bar'),name=el('input');
      name.placeholder=matrix?'모든 행에 추가할 필드 이름':'추가할 필드 이름';name.setAttribute('aria-label',name.placeholder);name.className='grid-new-key';
      const select=typeSelect(initial(isArray&&matrix?'mapValue':'stringValue'),'추가할 항목',{arrayItem:isArray&&!matrix});
      select.className='grid-add-type';
      if(!isArray||matrix)addBar.append(name);
      if(!matrix)addBar.append(select);
      const add=button(isArray?'＋ 행 추가':'＋ 필드 추가',()=>{
        if(!guard())return;
        const page=state.page;
        if(isArray)state.page=Math.floor(total/PAGE_SIZE);
        const ok=change(root=>{
          const node=valueAt(root,state.path);
          if(isArray){node.arrayValue.values??=[];node.arrayValue.values.push(matrix?blankRow(items[0]):initial(select.value));}
          else{node.mapValue.fields??={};if(Object.hasOwn(node.mapValue.fields,name.value))throw new Error('같은 이름의 필드가 있습니다.');put(node.mapValue.fields,name.value,initial(select.value));}
        });
        if(!ok)state.page=page;
      },'primary small');
      add.classList.add('grid-add-row');addBar.append(add);
      if(matrix){
        const addField=button('＋ 모든 행에 필드 추가',()=>{
          if(!guard())return;
          change(root=>{
            if(!name.value)throw new Error('추가할 필드 이름을 입력하세요.');
            for(const item of valueAt(root,state.path).arrayValue.values){
              item.mapValue.fields??={};
              if(!Object.hasOwn(item.mapValue.fields,name.value))put(item.mapValue.fields,name.value,initial('stringValue'));
            }
          });
        });
        addField.classList.add('grid-add-column');addBar.append(addField);
      }
      $('gridTools').append(addBar);
    }
    $('gridLocation').textContent=(isArray?'배열':'객체')+' · '+total+'개'+(matrix?' · 각 행은 객체입니다.':'');
  }
  function reset(){
    if(dialog.open)dialog.close();
    state=null;
    for(const id of ['gridContent','gridTools','gridBreadcrumbs'])$(id).replaceChildren();
    $('gridTitle').textContent='표 편집';$('gridLocation').textContent='';error('');
  }
  function close(){if(!state||guard())reset();}
  $('gridClose').addEventListener('click',close);
  $('gridCancel').addEventListener('click',()=>{if(state&&!state.readOnly)state.onChange(copy(state.original));reset();});
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  return {
    reset,
    open({value,title,readOnly=false,onChange}){
      validateValue(value);if(!complex(value))throw new Error('객체 또는 배열을 선택하세요.');
      reset();state={value:copy(value),original:copy(value),title,path:[],page:0,readOnly,onChange};
      $('gridTitle').textContent=title+' · '+(readOnly?'표 보기':'표 편집');$('gridCancel').hidden=readOnly;
      render();dialog.showModal();$('gridClose').focus();
    }
  };
}
