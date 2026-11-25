const {spawn}=require('node:child_process');

function extractArchive(tool,firstVolume,destination){
  return new Promise((resolve,reject)=>{
    const process=spawn(tool,['x','-y','-bb0','-pMEU_ACERVO_NO_PASSWORD','-o'+destination,'--',firstVolume],{
      windowsHide:true,stdio:['ignore','pipe','pipe']
    });
    let output='';
    for(const stream of [process.stdout,process.stderr]){
      stream.on('data',chunk=>{output=(output+chunk.toString()).slice(-2000)});
    }
    process.once('error',reject);
    process.once('close',code=>{
      if(code===0)return resolve();
      if(/wrong password|encrypted/i.test(output))return reject(new Error('O arquivo exige senha.'));
      reject(new Error('Falha na extração. Verifique se todos os volumes estão presentes e íntegros. (7-Zip: '+code+')'));
    });
  });
}

module.exports={extractArchive};

