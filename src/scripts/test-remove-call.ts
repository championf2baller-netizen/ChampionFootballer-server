import '../models';
import Match from '../models/Match';
import User from '../models/User';
import League from '../models/League';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/env';

async function main() {
  const matchId = 'a8397469-f6ea-48ea-a5ab-e79b506e617d';
  const leagueId = '1e91fbf0-3bf3-49a9-b14e-ae38bf921817';
  const sakandarId = '17a2a651-f346-4925-8141-5aa034585fd2';

  // Find users
  const adminUser = await User.findOne({ where: { email: 'techsolutionor1@gmail.com' } });
  console.log('Admin user found:', adminUser?.id, adminUser?.email, 'isAdmin:', adminUser?.isAdmin, 'role:', adminUser?.role);

  if (!adminUser) {
    console.log('No admin user');
    process.exit(1);
  }

  const token = jwt.sign({ userId: adminUser.id, email: adminUser.email }, JWT_SECRET);

  // Call the remove endpoint
  const res = await fetch(`http://localhost:5000/leagues/${leagueId}/matches/${matchId}/remove`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      team: 'home',
      playerId: sakandarId
    })
  });

  console.log('Response status:', res.status);
  const data = await res.json();
  console.log('Response body:', JSON.stringify(data, null, 2));

  // Check DB match after call
  const m = await Match.findByPk(matchId);
  console.log('Match removed column in DB now:', (m as any)?.removed);
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
