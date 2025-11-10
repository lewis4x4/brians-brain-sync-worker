require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Check the constraint
supabase.rpc('exec_sql', {
  query: `
    SELECT con.conname, pg_get_constraintdef(con.oid)
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'ingestion_runs' AND con.conname LIKE '%status%';
  `
}).then(({data, error}) => {
  if (error) {
    console.log('Cannot query constraint, trying common values...');
    console.log('Likely valid values: success, failed, running');
  } else {
    console.log('Constraint:', data);
  }
});
