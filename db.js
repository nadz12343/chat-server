const Pool = require('pg').Pool;

const pool = new Pool({
    user: "postgres",
    password: 'zovbos-5dugxa-sYwmej',
    database: 'postgres',
    host: 'db.iqwckccxsmjgjfocdbqq.supabase.co',
    port: 5432
})

module.exports = pool