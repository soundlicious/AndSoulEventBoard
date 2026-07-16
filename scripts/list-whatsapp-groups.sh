#!/usr/bin/env bash
set -euo pipefail

docker compose exec bot node -e 'import("baileys").then(async b=>{const {state}=await b.useMultiFileAuthState("/app/auth/state");const sock=b.default({auth:state,browser:["JIDLookup","Chrome","1.0"]});sock.ev.on("connection.update",async ({connection})=>{if(connection==="open"){const groups=await sock.groupFetchAllParticipating();for(const g of Object.values(groups)){console.log(`${g.subject} => ${g.id}`)}process.exit(0)}})})'
