// Inlines src/*.js into one self-contained index.html.
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const read = f => readFileSync(dir + 'src/' + f, 'utf8');
const js = ['core.js', 'levels.js', 'game.js'].map(read).join('\n');
if (js.includes('</script')) throw new Error('script text would close the tag');
// index.html fills the window; embed.html is the same game sized by its container, for inline frames
writeFileSync(dir + 'index.html', read('shell.html').replace('/*__SCRIPT__*/', () => js));
writeFileSync(dir + 'embed.html', read('embed.html').replace('/*__SCRIPT__*/', () => js));
console.log('index.html + embed.html', (js.length / 1024).toFixed(1) + ' KB of script');
