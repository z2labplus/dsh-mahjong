import { issueAccess } from '../src/auth';

const [tenant, owner] = process.argv.slice(2);
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(tenant ?? '') || !/^[a-zA-Z0-9_-]{1,80}$/.test(owner ?? '')) {
  throw new Error('Usage: SERVICE_SECRET=... npm run token -- <tenant> <owner>');
}
// Print only when the administrator explicitly invokes this command. Keep the
// deployment signing secret on the administrator machine, never in Harness.
console.log(await issueAccess(process.env.SERVICE_SECRET ?? '', {
  v: 1, kind: 'owner', tenant: tenant!, owner: owner!, ...(process.argv.includes('--admin') ? {admin:true} : {}), exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));
