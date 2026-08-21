import { Context } from 'koa';
import { Op } from 'sequelize';
import StaticContent from '../models/StaticContent';
import User from '../models/User';
import { uploadToCloudinary } from '../middleware/upload';
import { invalidateCache as invalidateMemoryCache } from '../middleware/memoryCache';

/**
 * Middleware: Verify Admin Access
 */
export const requireAdmin = async (ctx: Context, next: () => Promise<any>) => {
  if (!ctx.state.user || !ctx.state.user.userId) {
    ctx.status = 401;
    ctx.body = { success: false, message: 'Authentication required' };
    return;
  }

  const userId = String(ctx.state.user.userId);
  const user = await User.findByPk(userId);

  if (!user || (!user.isAdmin && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
    ctx.status = 403;
    ctx.body = { success: false, message: 'Access denied: Admin privileges required' };
    return;
  }

  await next();
};

/**
 * Default static content seed items
 */
const DEFAULT_ITEMS = [
  // --- REWARDS & BADGES (EXACT OFFICIAL HEADINGS) ---
  {
    key: 'reward_scoring_10_consecutive',
    category: 'rewards',
    title: 'Goal Rush',
    content: 'Scoring in 5 consecutive matches in a league and season',
    metadata: { xp: 100, rewardId: 'scoring_10_consecutive' }
  },
  {
    key: 'reward_assist_10_consecutive',
    category: 'rewards',
    title: 'Pure Magic',
    content: 'Assist in 5 consecutive matches in a league and season',
    metadata: { xp: 100, rewardId: 'assist_10_consecutive' }
  },
  {
    key: 'reward_hat_trick_3_matches',
    category: 'rewards',
    title: 'Triple Treat',
    content: 'Score a hat-trick in 3 consecutive matches in a league and season',
    metadata: { xp: 150, rewardId: 'hat_trick_3_matches' }
  },
  {
    key: 'reward_captain_5_wins',
    category: 'rewards',
    title: 'Leader of Legends',
    content: 'Winning as a captain in 3 matches in a league and season',
    metadata: { xp: 200, rewardId: 'captain_5_wins' }
  },
  {
    key: 'reward_captain_performance_3',
    category: 'rewards',
    title: 'The X-Factor',
    content: 'Being voted +Mentality player or Defensive Impact 5 matches in a league and season',
    metadata: { xp: 200, rewardId: 'captain_performance_3' }
  },
  {
    key: 'reward_motm_4_consecutive',
    category: 'rewards',
    title: 'Spotlight Star',
    content: 'Winning Man of the Match award 3 times (not votes) in a league and season',
    metadata: { xp: 250, rewardId: 'motm_4_consecutive' }
  },
  {
    key: 'reward_clean_sheet_5_wins',
    category: 'rewards',
    title: 'Finders Keepers',
    content: 'Keeping 3 clean sheets as a team in a league and season',
    metadata: { xp: 300, rewardId: 'clean_sheet_5_wins' }
  },
  {
    key: 'reward_top_spot_10_matches',
    category: 'rewards',
    title: 'Iron Will',
    content: 'Playing 90% of matches in a league and season',
    metadata: { xp: 400, rewardId: 'top_spot_10_matches' }
  },
  {
    key: 'reward_consecutive_10_victories',
    category: 'rewards',
    title: 'Win Streak X',
    content: 'Winning in 10 consecutive matches in a league and season',
    metadata: { xp: 500, rewardId: 'consecutive_10_victories' }
  },

  // --- GENERAL PLATFORM CONTENT & HEADINGS ---
  {
    key: 'about_cf',
    category: 'general',
    title: 'About Champion Footballer',
    content: `Champion Footballer is where football becomes more than just a kickabout with friends it becomes your journey to greatness!

Whether you're playing 5 or 7-a-side under the lights, dominating the local cage, or enjoying a weekend match at the park, CF turns every game into a competitive and unforgettable experience.

Create your player card, organise matches with ease, choose teams from a live player availability list, and track every goal, win, result, and rivalry as you build your football legacy. Keep the competition alive with real stats, rankings, league tables, and match history where every performance counts and every goal matters.

Fight for the top spot, dominate your league, and prove who truly deserves Player of the Match. After every game, vote for standout players, earn virtual awards, and climb your way to football bragging rights.

CF combines the energy of football, competition, and social gaming into one experience built for true football fans. Connect with players, create unforgettable matches, and bring the beautiful game to life every time you step onto the pitch.

Play hard! Compete harder!
Become Champion Footballer!`,
    metadata: {}
  },
  {
    key: 'how_to_play',
    category: 'general',
    title: 'How to Play Champion Footballer',
    content: `1. Complete Your Player Card
Set up your player profile with your player card and profile picture to start tracking your football journey.

2. Join or Create a League
Join an existing league using an invite code or create your own league and invite friends to compete throughout the season.

3. Create a New Match
League Admins can schedule match fixtures by selecting the date, time, venue and match format. All players will be notified.

4. Confirm Your Availability
Lock in your spot by marking yourself Available. Players are ranked by response time, so the earlier you confirm, the higher you'll appear.

5. Team Selection
Once enough players have confirmed, teams are generated. Teams can be automatically balanced, randomly generated, or selected manually.

6. Play the Match
Take to the pitch, enjoy the game and compete with your teammates. Every match contributes to your season statistics.

7. Submit the Match Result
After the match, the League Admin submits the final score to update the league table.

8. Add Your Individual Stats
Add your goals, assists, clean sheets and match stats after every game.

9. Track Your Performance
View your stats, performance trends, achievements and career history as you progress.

10. Trophy Room and Awards
Compete for individual awards and seasonal honours. Every achievement is stored in your Trophy Room.

MANAGEMENT CONTROLS:
• League Admins: Create leagues, manage players, schedule fixtures, generate teams, add scores, approve player stats and manage league settings.
• League Players: Confirm availability, view fixtures, submit match statistics, track performance and follow league standings.`,
    metadata: {}
  },
  {
    key: 'game_rules',
    category: 'general',
    title: 'Game Rules & League Point Scoring',
    content: JSON.stringify([
      { action: 'Winning Team Bonus', desc: 'Winning a match', winning: '30 xp', losing: '', isLosingEmpty: true, points: '3 Points' },
      { action: 'Draw', desc: 'Drawing a match', winning: '15 xp', losing: '15 xp', isMerged: true, points: '1 Point' },
      { action: 'Losing Team Consolation', desc: 'Losing a match', winning: '', isWinningEmpty: true, losing: '10 xp', points: '0 Points' },
      { action: 'Man of the Match (MOTM)', desc: 'Player with the most count of Man of the Match votes in a single Match', winning: '10 xp', losing: '5 xp', points: '0 Points' },
      { action: 'Clean Sheets', desc: 'Player keeping a clean sheet during their total episodes in goal', winning: '5 xp', losing: '5 xp', isMerged: true, points: '0 Points' },
      { action: 'Goal Scored', desc: 'Total number of goals scored by a player', winning: '3 xp', losing: '2 xp', points: '0 Points' },
      { action: 'Assist', desc: 'Total number of goal assists made by a player', winning: '2 xp', losing: '1 xp', points: '0 Points' },
      { action: 'Man of the Match Votes', desc: 'Player receiving individual count of votes per match', winning: '2 xp', losing: '1 xp', points: '0 Points' },
      { action: 'Defensive Impact', desc: 'Decisive defensive or goalkeeping performance in the match', winning: '2 xp', losing: '1 xp', points: '0 Points' },
      { action: '+ Mentality', desc: 'Recognise positive mentality and sportsmanship in the match.', winning: '2 xp', losing: '2 xp', points: '0 Points' }
    ], null, 2),
    metadata: {}
  },
  {
    key: 'xp_status',
    category: 'general',
    title: 'XP Status & Level Milestones',
    content: JSON.stringify([
      { level: 1, title: 'Rookie', range: '0 - 500', desc: 'Building your way to football dominance, all the way to Champion Footballer', color: '#B0B0B0', label: 'Cool Gray' },
      { level: 2, title: 'Rising Star', range: '500 - 2,500', desc: 'Rising in prominence with every performance', color: '#4AA3FF', label: 'Sky Blue' },
      { level: 3, title: 'Baller', range: '2,500 - 5,000', desc: "A force on the field that can't be ignored", color: '#00a896', label: 'Green' },
      { level: 4, title: 'Pro', range: '5,000 - 15,000', desc: 'High mastery and control over the matches, consistently excelling and asserting dominance in your position', color: '#9B59B6', label: 'Purple' },
      { level: 5, title: 'Elite', range: '15,000 - 25,000', desc: 'Regarded as an elite player by peers, known for unwavering talent and a relentless winning mentality', color: '#3448FF', label: 'Royal Blue' },
      { level: 6, title: 'Champion Footballer', range: '25,000 - 50,000', desc: 'Attaining coveted status as a benchmark of excellence. A true icon of the game, respected by peers and feared by opponents', color: '#E74C3C', label: 'Crimson' },
      { level: 7, title: 'GOAT', range: '50,000+', desc: 'An undisputed footballer, forever cemented in the history books as the greatest of all time', color: '#F1C40F', label: 'Gold' }
    ], null, 2),
    metadata: {}
  },
  {
    key: 'home_welcome_text',
    category: 'home',
    title: 'Home Welcome Greeting',
    content: 'Welcome,',
    metadata: {}
  },
  {
    key: 'home_league_subtitle',
    category: 'home',
    title: 'Home Current League Subtitle',
    content: 'Your Current League In Which You Stand',
    metadata: {}
  },
  {
    key: 'home_live_stats_heading',
    category: 'home',
    title: 'Home Live Stats Heading',
    content: 'YOUR LIVE STATS',
    metadata: {}
  },
  {
    key: 'home_create_league_btn',
    category: 'home',
    title: 'Home Create League Button',
    content: '+ Create New League',
    metadata: {}
  },
  {
    key: 'home_join_league_btn',
    category: 'home',
    title: 'Home Join League Button',
    content: 'Join League',
    metadata: {}
  },
  {
    key: 'terms_conditions',
    category: 'general',
    title: 'Terms & Conditions',
    content: `1. AGREEMENT TO TERMS
These Terms of Use constitute a legally binding agreement made between you, whether personally or on behalf of an entity ("you") and Champion Footballer, concerning your access to and use of the championfootballer.com website as well as any other media form, media channel, mobile website or mobile application related, linked, or otherwise connected thereto. We are registered in England and have our registered address at 85 Great Portland St, London, England, W1W 7LT. You agree that by accessing the Site, you have read, understood, and agreed to be bound by all of these Terms of Use.

2. INTELLECTUAL PROPERTY RIGHTS
Unless otherwise indicated, the Site is our proprietary property and all source code, databases, functionality, software, website designs, audio, video, text, photographs, and graphics on the Site and the trademarks, service marks, and logos contained therein are owned or controlled by us or licensed to us, and are protected by copyright and trademark laws.

3. USER REPRESENTATIONS
By using the Site, you represent and warrant that: (1) all registration information you submit will be true, accurate, current, and complete; (2) you will maintain the accuracy of such information; (3) you have legal capacity to comply with these Terms; (4) you are not under the age of 13; (5) your use will not violate any applicable law or regulation.

4. USER REGISTRATION
You may be required to register with the Site. You agree to keep your password confidential and will be responsible for all use of your account and password. We reserve the right to remove, reclaim, or change a username you select if we determine it is inappropriate or objectionable.

5. PROHIBITED ACTIVITIES
You may not access or use the Site for any purpose other than that for which we make the Site available.
- Systematically retrieve data or content to create or compile a database without written permission.
- Trick, defraud, or mislead us or other users.
- Circumvent or interfere with security-related features.
- Engage in unauthorized framing or linking to the Site.
- Upload or transmit viruses, Trojan horses, or spamming materials.

6. USER GENERATED CONTRIBUTIONS
The Site may invite you to chat, contribute to blogs, message boards, or submit content (text, video, graphics, comments, or feedback). You represent and warrant that your Contributions do not infringe any third-party rights and are accurate and non-misleading.

7. CONTRIBUTION LICENSE
By posting Contributions to any part of the Site, you automatically grant us an unrestricted, unlimited, irrevocable, perpetual, non-exclusive, transferable, royalty-free, fully-paid, worldwide right and license to use, copy, reproduce, display, and distribute such Contributions for any purpose.

8. MOBILE APPLICATION LICENSE
If you access the Site via a mobile application, we grant you a revocable, non-exclusive, non-transferable, limited right to install and use the mobile application on wireless electronic devices owned or controlled by you strictly in accordance with these Terms.

9. SUBMISSIONS
You acknowledge and agree that any questions, comments, suggestions, ideas, feedback, or other information regarding the Site ("Submissions") provided by you to us are non-confidential and shall become our sole property.

10. ADVERTISERS
We allow advertisers to display their advertisements and other information in certain areas of the Site. Advertisers take full responsibility for any advertisements placed on the Site.

11. SITE MANAGEMENT
We reserve the right, but not the obligation, to: (1) monitor the Site for violations of these Terms; (2) take appropriate legal action against anyone violating the law; (3) refuse, restrict access to, or disable any Contributions; (4) manage the Site to protect our rights and property.

12. PRIVACY POLICY
We care about data privacy and security. By using the Site, you agree to be bound by our Privacy Policy posted on the Site, which is incorporated into these Terms of Use.

13. TERM AND TERMINATION
These Terms of Use shall remain in full force and effect while you use the Site. WE RESERVE THE RIGHT TO DENY ACCESS TO AND USE OF THE SITE TO ANY PERSON FOR ANY REASON OR FOR NO REASON.

14. MODIFICATIONS AND INTERRUPTIONS
We reserve the right to change, modify, or remove the contents of the Site at any time or for any reason at our sole discretion without notice. We will not be liable to you or any third party for any modification or discontinuance of the Site.

15. GOVERNING LAW
These conditions are governed by and interpreted following the laws of England, and the use of the United Nations Convention of Contracts for the International Sale of Goods is expressly excluded.

16. DISPUTE RESOLUTION
To expedite resolution and control the cost of any dispute, controversy, or claim related to these Terms of Use, the Parties agree to first attempt to negotiate any Dispute informally for at least ninety (90) days before initiating arbitration.

17. CORRECTIONS
There may be information on the Site that contains typographical errors, inaccuracies, or omissions. We reserve the right to correct any errors, inaccuracies, or omissions at any time without prior notice.

18. DISCLAIMER
THE SITE IS PROVIDED ON AN AS-IS AND AS-AVAILABLE BASIS. YOU AGREE THAT YOUR USE OF THE SITE AND OUR SERVICES WILL BE AT YOUR SOLE RISK.

19. LIMITATIONS OF LIABILITY
IN NO EVENT WILL WE OR OUR DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE TO YOU OR ANY THIRD PARTY FOR ANY DIRECT, INDIRECT, CONSEQUENTIAL, EXEMPLARY, INCIDENTAL, SPECIAL, OR PUNITIVE DAMAGES.

20. INDEMNIFICATION
You agree to defend, indemnify, and hold us harmless from and against any loss, damage, liability, claim, or demand due to or arising out of your Contributions or use of the Site.

21. USER DATA
We will maintain certain data that you transmit to the Site for the purpose of managing the performance of the Site.

22. ELECTRONIC COMMUNICATIONS, TRANSACTIONS, AND SIGNATURES
Visiting the Site, sending us emails, and completing online forms constitute electronic communications. You consent to receive electronic communications.

23. CALIFORNIA USERS AND RESIDENTS
If any complaint with us is not satisfactorily resolved, you can contact the Complaint Assistance Unit of the Division of Consumer Services of the California Department of Consumer Affairs.

24. MISCELLANEOUS
These Terms of Use and any policies posted by us on the Site constitute the entire agreement and understanding between you and us.

25. CONTACT US
In order to resolve a complaint regarding the Site or to receive further information regarding use of the Site, please contact us at support@championfootballer.co.uk or championfootballer@outlook.com`,
    metadata: {}
  },
  {
    key: 'privacy_policy',
    category: 'general',
    title: 'Privacy Policy',
    content: `1. Purpose of this Privacy Policy
This privacy notice for Champion Footballer describes how and why we might collect, store, use, and/or share ("process") your information when you use our services ("Services") through your use of this website and any mobile application ("Platform").
Questions or concerns? Reading this privacy notice will help you understand your privacy rights and choices. If you do not agree with our policies and practices, please do not use our Services. If you still have any questions or concerns, please contact us at championfootballer@outlook.com.
Champion Footballer respects your privacy and is dedicated to protecting your personal data. This privacy notice will inform you as to how we look after your personal data when you visit our Platform and tell you about your privacy rights and how the law protects you.
We collect, use and are responsible for certain personal information about you under relevant data protection laws (including GDPR).

2. Summary of Key Points
• What personal information do we process? User first name, surname, age, gender, email address, login details, and match performance statistics.
• How do we process your information? We process your information to provide, improve, and administer our Services, communicate with you, for security and fraud prevention, and to comply with law.
• Sensitive Information: We do not process sensitive personal information.

3. Table of Contents
• WHAT INFORMATION DO WE COLLECT?
• HOW DO WE PROCESS YOUR INFORMATION?
• WHEN AND WITH WHOM DO WE SHARE YOUR PERSONAL INFORMATION?
• DO WE USE COOKIES AND OTHER TRACKING TECHNOLOGIES?
• HOW DO WE HANDLE YOUR SOCIAL LOGINS?
• IS YOUR INFORMATION TRANSFERRED INTERNATIONALLY?
• HOW LONG DO WE KEEP YOUR INFORMATION?
• DO WE COLLECT INFORMATION FROM MINORS?
• WHAT ARE YOUR PRIVACY RIGHTS?
• CONTROLS FOR DO-NOT-TRACK FEATURES
• DO CALIFORNIA RESIDENTS HAVE SPECIFIC PRIVACY RIGHTS?
• DO WE MAKE UPDATES TO THIS NOTICE?
• HOW CAN YOU CONTACT US ABOUT THIS NOTICE?
• HOW CAN YOU REVIEW, UPDATE, OR DELETE THE DATA WE COLLECT FROM YOU?
• COOKIE POLICY

4. What Information Do We Collect?
Personal information you disclose to us:
We collect personal information that you voluntarily provide to us when you register on the Services, express an interest in obtaining information about us or our products and Services, when you participate in activities on the Services, or otherwise when you contact us.
- Identity Data: Includes first name, last name, username, age and gender.
- Contact Data: Includes email address.
- Technical Data: Includes IP address, login data, browser type, operating system and platform.
- Profile Data: Includes your username, preferences, feedback, and match statistics.
- Usage Data: Includes information about how you use our Platform, products and services.

5. How Do We Process Your Information?
We process your information to provide, improve, and administer our Services, communicate with you, for security and fraud prevention, and to comply with law. We process your information only when we have a valid legal reason to do so.

6. When and With Whom Do We Share Your Personal Information?
We may share information in specific situations such as Business Transfers, with Affiliates (parent company and subsidiaries), or with trusted Business Partners to offer certain features or services.

7. Do We Use Cookies and Other Tracking Technologies?
We may use cookies and similar tracking technologies (like web beacons and pixels) to access or store information. Specific information is set out in our Cookie Notice.

8. How Do We Handle Your Social Logins?
Our Services may offer you the ability to register and log in using third-party social media account details. We will use the profile information we receive only for the purposes described in this privacy notice.

9. Is Your Information Transferred Internationally?
Our servers are located securely. If you access our Services from outside, your information may be transferred to and processed in our facilities in accordance with applicable data protection laws.

10. How Long Do We Keep Your Information?
We will only keep your personal information for as long as necessary for the purposes set out in this privacy notice, unless a longer retention period is required by law.

11. Do We Collect Information From Minors?
We do not knowingly solicit data from or market to children under 18 years of age. Users under 18 must have parental/guardian consent.

12. What Are Your Privacy Rights?
In Short: You may review, change, or terminate your account at any time. Depending on your location (EEA/UK), you have specific rights to request access, correction, or deletion of your personal data.

13. Controls for Do-Not-Track Features
Most web browsers include a Do-Not-Track ("DNT") feature. We will comply with uniform DNT standards once finalized by regulatory authorities.

14. Do California Residents Have Specific Privacy Rights?
California Civil Code Section 1798.83 permits California residents to request details regarding categories of personal information shared with third parties for direct marketing.

15. Do We Make Updates to This Notice?
We may update this privacy notice from time to time to stay compliant with relevant laws. Updated versions will be indicated by a revised date.

16. How Can You Contact Us About This Notice?
If you have questions or comments about this notice, you may email us at championfootballer@outlook.com or support@championfootballer.co.uk or by post to:
Suite RA01, 195-197 Wood Street, London, E17 3NU

17. How Can You Review, Update, or Delete The Data We Collect From You?
You may submit a request to review, update, or delete your personal information by contacting support or submitting a request on championfootballer.com.

18. Cookie Policy
This Cookie Policy explains how Champion Footballer uses cookies and similar technologies. We use first and third-party cookies for essential site operation, performance analytics, and enhancing user experience. You can control cookie preferences via browser settings.`,
    metadata: {}
  },
  {
    key: 'contact_details',
    category: 'general',
    title: 'Contact Us',
    content: 'Have a question or feedback? Contact our support team at support@championfootballer.co.uk or via WhatsApp +44 7000 000000.',
    metadata: { email: 'support@championfootballer.co.uk', phone: '+44 7000 000000' }
  }
];

import bcrypt from 'bcrypt';

let hasSeeded = false;

/**
 * Helper: Auto-seed Super Admin user & default static content
 */
export const ensureDefaultsExist = async () => {
  if (hasSeeded) return;
  try {
    const sequelize = User.sequelize!;

    // 0. Ensure PostgreSQL table schema is updated with isAdmin and role columns
    await sequelize.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN DEFAULT false;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" VARCHAR(255) DEFAULT 'PLAYER';
      CREATE TABLE IF NOT EXISTS "static_contents" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "key" VARCHAR(255) UNIQUE NOT NULL,
        "category" VARCHAR(255) NOT NULL DEFAULT 'general',
        "title" VARCHAR(255) NOT NULL,
        "content" TEXT NOT NULL DEFAULT '',
        "metadata" JSONB DEFAULT '{}',
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "updatedBy" VARCHAR(255),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    // 1. Seed Super Admin User
    const adminEmail = 'admin@championfootballer.co.uk';
    let adminUser = await User.findOne({ where: { email: adminEmail } });

    if (!adminUser) {
      const hashedPassword = await bcrypt.hash('Admin@123456', 10);
      adminUser = await User.create({
        firstName: 'Super',
        lastName: 'Admin',
        email: adminEmail,
        password: hashedPassword,
        isVerified: true,
        isAdmin: true,
        role: 'SUPER_ADMIN',
        provider: 'local',
        providerId: null,
      });
      console.log('✅ Created Default Super Admin User:', adminEmail);
    } else if (!adminUser.isAdmin || adminUser.role !== 'SUPER_ADMIN') {
      adminUser.isAdmin = true;
      adminUser.role = 'SUPER_ADMIN';
      await adminUser.save();
      console.log('✅ Granted Super Admin Privileges to:', adminEmail);
    }

    // 2. Clean up any obsolete keys (e.g. old single rewards_info key or temporary test keys)
    await StaticContent.destroy({
      where: {
        key: [
          'rewards_info',
          'reward_hat_trick_hero',
          'reward_captain_leader',
          'reward_assist_king',
          'reward_goal_machine',
          'reward_defensive_wall',
          'reward_motm_master',
          'reward_clean_sheet',
          'reward_iron_will',
          'reward_invincible_streak'
        ]
      }
    });

    // Delete announcement_banner, app_rules, and faq if they exist in DB
    await StaticContent.destroy({ where: { key: ['announcement_banner', 'app_rules', 'faq'] } });

    // Ensure categories for terms_conditions, privacy_policy, contact_details, game_rules, xp_status are updated to 'general'
    await StaticContent.update(
      { category: 'general' },
      { where: { key: ['terms_conditions', 'privacy_policy', 'contact_details', 'game_rules', 'xp_status'] } }
    );

    // 3. Seed missing Static Content Items
    for (const item of DEFAULT_ITEMS) {
      const existing = await StaticContent.findOne({ where: { key: item.key } });
      if (!existing) {
        await StaticContent.create(item);
        console.log(`🌱 Created static content item: ${item.key}`);
      } else if (item.category === 'rewards' || item.key.startsWith('reward_') || (item.key === 'terms_conditions' && existing.content.length < 500)) {
        existing.title = item.title;
        existing.content = item.content;
        await existing.save();
        console.log(`🔄 Seeded complete text for static content item '${item.key}'`);
      }
    }
    hasSeeded = true;
  } catch (err) {
    console.error('StaticContent & Admin seed check failed:', err);
  }
};

/**
 * PUBLIC API: Get all active static content (for Mobile App & Web App)
 * GET /api/static-content
 * GET /api/static-content/:key
 */
export const getPublicStaticContent = async (ctx: Context) => {
  try {
    ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    await StaticContent.destroy({ where: { key: ['announcement_banner', 'app_rules', 'faq'] } });
    await ensureDefaultsExist();
    const { key } = ctx.params;

    if (key) {
      if (key === 'announcement_banner') {
        ctx.status = 404;
        ctx.body = { success: false, message: 'Static content not found' };
        return;
      }
      const item = await StaticContent.findOne({
        where: { key, isActive: true }
      });
      if (!item) {
        ctx.status = 404;
        ctx.body = { success: false, message: `Static content '${key}' not found` };
        return;
      }
      ctx.body = {
        success: true,
        data: item
      };
      return;
    }

    const items = await StaticContent.findAll({
      where: { isActive: true, key: { [Op.ne]: 'announcement_banner' } },
      order: [['category', 'ASC'], ['title', 'ASC']]
    });

    const contentMap: Record<string, any> = {};
    items.forEach((it: any) => {
      contentMap[it.key] = {
        title: it.title,
        content: it.content,
        category: it.category,
        metadata: it.metadata,
        updatedAt: it.updatedAt
      };
    });

    ctx.body = {
      success: true,
      data: items,
      contentMap
    };
  } catch (err) {
    console.error('getPublicStaticContent error:', err);
    ctx.status = 500;
    ctx.body = { success: false, message: 'Failed to fetch static content' };
  }
};

/**
 * ADMIN API: Get all static content items (including inactive)
 * GET /api/admin/static-content
 */
export const getAllStaticContentAdmin = async (ctx: Context) => {
  try {
    ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    await StaticContent.destroy({ where: { key: ['announcement_banner', 'app_rules', 'faq'] } });
    await ensureDefaultsExist();
    const items = await StaticContent.findAll({
      where: {
        key: { [Op.notIn]: ['announcement_banner', 'app_rules', 'faq'] }
      },
      order: [['updatedAt', 'DESC']]
    });

    ctx.body = {
      success: true,
      items
    };
  } catch (err) {
    console.error('getAllStaticContentAdmin error:', err);
    ctx.status = 500;
    ctx.body = { success: false, message: 'Failed to fetch static content items' };
  }
};

/**
 * ADMIN API: Upsert (Create or Update) static content item
 * POST /api/admin/static-content
 * PUT /api/admin/static-content/:key
 */
export const upsertStaticContentAdmin = async (ctx: Context) => {
  try {
    const userId = String(ctx.state.user.userId);
    const body = ctx.request.body as any;
    const keyParam = ctx.params.key;

    const key = (keyParam || body.key || '').trim();
    const { title, content, category, metadata, isActive } = body;

    if (!key) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'Key is required' };
      return;
    }

    let existing = await StaticContent.findOne({ where: { key } });

    if (existing) {
      if (title !== undefined) existing.title = title;
      if (content !== undefined) existing.content = content;
      if (category !== undefined) existing.category = category;
      if (metadata !== undefined) existing.metadata = metadata;
      if (isActive !== undefined) existing.isActive = Boolean(isActive);
      existing.updatedBy = userId;
      await existing.save();
      invalidateMemoryCache('/api/static-content');

      ctx.body = {
        success: true,
        message: `Static content '${key}' updated successfully`,
        item: existing
      };
    } else {
      if (!title) {
        ctx.status = 400;
        ctx.body = { success: false, message: 'Title is required for new item' };
        return;
      }
      const newItem = await StaticContent.create({
        key,
        title,
        content: content || '',
        category: category || 'general',
        metadata: metadata || {},
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        updatedBy: userId
      });

      invalidateMemoryCache('/api/static-content');

      ctx.body = {
        success: true,
        message: `Static content '${key}' created successfully`,
        item: newItem
      };
    }
  } catch (err) {
    console.error('upsertStaticContentAdmin error:', err);
    ctx.status = 500;
    ctx.body = { success: false, message: 'Failed to save static content' };
  }
};

/**
 * ADMIN API: Delete static content item
 * DELETE /api/admin/static-content/:key
 */
export const deleteStaticContentAdmin = async (ctx: Context) => {
  try {
    const { key } = ctx.params;
    if (!key) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'Key parameter is required' };
      return;
    }

    const count = await StaticContent.destroy({ where: { key } });

    if (count === 0) {
      ctx.status = 404;
      ctx.body = { success: false, message: `Item with key '${key}' not found` };
      return;
    }

    invalidateMemoryCache('/api/static-content');
    ctx.body = {
      success: true,
      message: `Static content '${key}' deleted successfully`
    };
  } catch (err) {
    console.error('deleteStaticContentAdmin error:', err);
    ctx.status = 500;
    ctx.body = { success: false, message: 'Failed to delete static content' };
  }
};

/**
 * ADMIN API: Upload static content image (e.g. for How to Play step images)
 * POST /api/admin/static-content/upload-image
 */
export const uploadStaticImageAdmin = async (ctx: Context) => {
  try {
    const file = (ctx as any).file;
    if (!file) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'No image file uploaded' };
      return;
    }

    let imageUrl = '';
    try {
      imageUrl = await uploadToCloudinary(file.buffer, 'static-content-images');
    } catch (cErr) {
      console.warn('Cloudinary upload fallback to base64 data URL:', cErr);
      const mime = file.mimetype || 'image/png';
      const b64 = file.buffer.toString('base64');
      imageUrl = `data:${mime};base64,${b64}`;
    }

    ctx.body = {
      success: true,
      imageUrl
    };
  } catch (err: any) {
    console.error('uploadStaticImageAdmin error:', err);
    ctx.status = 500;
    ctx.body = { success: false, message: err.message || 'Failed to upload image' };
  }
};
