// 프롬프트 캔버스의 관리자 비밀번호를 서버에 넣을 값(SHA-256, 64자)으로 바꿔요.
// 쓰는 법: npm run password:hash  → 비밀번호를 입력하면 64자 값이 나와요.
// 나온 값을 `npx wrangler secret put HAIKU_CANVAS_PASSWORD_HASH`에 붙여 넣으세요.
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const typed = await rl.question('캔버스 관리자 비밀번호(영문·숫자 권장): ');
rl.close();
// 다른 프로그램에서 넘겨받은 입력 맨 앞에 붙을 수 있는 보이지 않는 표시 글자(코드 0xFEFF)는 떼어 내요.
const password = typed.charCodeAt(0) === 0xfeff ? typed.slice(1) : typed;
if (!password || password.length > 256) {
  console.error('비밀번호는 1~256자로 입력해 주세요.');
  process.exit(1);
}
console.log(createHash('sha256').update(password, 'utf8').digest('hex'));
