export const IMAGE_MODEL='recraft/recraft-v4.1-flash';
export const IMAGE_PRICE_USD=0.007;

// Route only direct image-making requests. Code/game work stays with Haiku.
export function imageIntent(content){
 const text=typeof content==='string'?content:Array.isArray(content)?content.filter(p=>p.type==='text').map(p=>p.text).join('\n'):'';
 if(text.includes('[첨부 HTML 파일:'))return null;
 const prompt=text.trim();
 if(!prompt||prompt.length>12000)return null;
 if(/(?:이미지|그림|사진)\s*(?:는|은|을|를)?\s*(?:만들지|생성하지|그리지|말고|없이)/i.test(prompt))return null;
 if(/(?:이미지|그림|사진).{0,12}(?:생성|만들|그리).{0,6}(?:기능|사이트|프로그램|코드|버튼)|(?:html|코드|게임|사이트|홈페이지|앱|프로그램)(?:을|를)?\s*(?:만들|제작|구현|수정|고쳐)/i.test(prompt))return null;
 const subject=/(?:이미지|그림|사진|일러스트|삽화|썸네일|아이콘|로고|스프라이트|배경화면|image|picture|illustration)/i;
 const action=/(?:만들|생성|그려|그리기|제작|그려줘|draw|generate|create)/i;
 if((subject.test(prompt)&&action.test(prompt))||/그려\s*(?:줘|주세요|줄래|봐)|\bdraw\b/i.test(prompt))return prompt;
 return null;
}

export function imageAspectRatio(prompt){
 const explicit=prompt.match(/(?:^|[^\d])(16:9|9:16|4:3|3:4|1:1)(?:[^\d]|$)/);
 if(explicit)return explicit[1];
 if(/세로|수직|portrait|vertical/i.test(prompt))return '9:16';
 if(/가로|와이드|배경|landscape|wide/i.test(prompt))return '16:9';
 return '1:1';
}
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function generateImage(prompt,env,signal){
 try{
  const response=await fetch('https://openrouter.ai/api/v1/images',{
   method:'POST',headers:{Authorization:'Bearer '+env.HAIKU_OPENROUTER_KEY,'Content-Type':'application/json','X-Title':'Haiku Game Learning'},
   signal:AbortSignal.any([signal,AbortSignal.timeout(90000)]),
   body:JSON.stringify({model:IMAGE_MODEL,prompt,n:1,aspect_ratio:imageAspectRatio(prompt)})
  });
  if(!response.ok){await response.body?.cancel();const code=response.status;
   return reply({error:code===402?'API 사용 잔액을 확인해 주세요.':code===429?'이미지 생성 요청이 많습니다. 잠시 후 다시 보내 주세요.':code===400||code===422?'이 요청으로 이미지를 만들지 못했습니다. 이미지 설명을 바꾸어 다시 요청해 주세요.':'이미지 생성 모델에 연결하지 못했습니다. 잠시 후 다시 요청해 주세요.'},code===402?402:code===429?429:502);
  }
  if(Number(response.headers.get('content-length'))>20*1024*1024)throw Error('large');
  const data=await response.json();
  const item=data.data?.[0],base64=item?.b64_json;
  if(typeof base64!=='string'||base64.length>14*1024*1024||!base64.length||base64.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw Error('invalid');
  const prefix=atob(base64.slice(0,32));
  const mime=prefix.startsWith('\x89PNG\r\n\x1a\n')?'image/png':prefix.startsWith('\xff\xd8\xff')?'image/jpeg':prefix.startsWith('RIFF')&&prefix.slice(8,12)==='WEBP'?'image/webp':null;
  if(!mime)throw Error('format');
  return reply({type:'image',model:IMAGE_MODEL,image:'data:'+mime+';base64,'+base64,mediaType:mime,costUsd:typeof data.usage?.cost==='number'&&Number.isFinite(data.usage.cost)?data.usage.cost:IMAGE_PRICE_USD});
 }catch(error){return reply({error:signal.aborted?'이미지 생성을 중지했습니다.':error.name==='TimeoutError'?'이미지 생성 시간이 길어지고 있습니다. 잠시 후 다시 요청해 주세요.':'이미지 생성 결과를 받지 못했습니다. 다시 요청해 주세요.'},502);}
}
