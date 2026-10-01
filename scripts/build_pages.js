const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const output=path.join(root,'dist');

fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(output,{recursive:true});
const excludedDirectories=new Set(['.git','.github','node_modules','dist','scripts']);
const publicFileExtensions=new Set(['.html','.js','.css','.json','.jpg','.jpeg','.png','.webp','.svg','.ico','.woff','.woff2']);
for(const entry of fs.readdirSync(root,{withFileTypes:true})){
  if(entry.isDirectory()){
    if(excludedDirectories.has(entry.name)||entry.name.startsWith('.'))continue;
    fs.cpSync(path.join(root,entry.name),path.join(output,entry.name),{recursive:true});
    continue;
  }
  if(entry.name.startsWith('.'))continue;
  if(publicFileExtensions.has(path.extname(entry.name).toLowerCase())){
    fs.copyFileSync(path.join(root,entry.name),path.join(output,entry.name));
  }
}
console.log(`Prepared static site in ${path.relative(root,output)}.`);
