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
    key: 'social_media_links',
    category: 'footer',
    title: 'Social Media Icons & Platform Links (Footer)',
    content: 'Manage social media profile links for Footer icons. Empty links will hide the corresponding icon automatically.',
    metadata: {
      socialLinks: {
        x: 'https://x.com/ChampionF2tball',
        instagram: 'https://www.instagram.com/championfooballer?igsh=d3F1OGplZ2IxaWdz',
        facebook: 'https://www.facebook.com/share/19R7iFrmfe/',
        youtube: 'https://www.youtube.com/@championf2tballer',
        tiktok: 'https://www.tiktok.com/@championf2tballer?_r=1&_t=ZS-98gdWDxrdZI',
        pinterest: '',
        snapchat: '',
        threads: '',
        twitch: '',
        telegram: '',
        reddit: '',
        linkedin: '',
        discord: '',
        whatsapp: '',
        website: ''
      }
    }
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

  // --- MAIN LANDING PAGE (FIRST PAGE) STATIC CONTENT & IMAGES ---
  {
    key: 'page_landing_images',
    category: 'landing',
    title: 'Main Landing Page Banners & Card Images (Upload Images)',
    content: '',
    metadata: {
      stepImages: {
        hero_top_bg: '',
        hero_grid_team1: '',
        hero_grid_orange: '',
        feature1_img: '',
        feature2_img: '',
        feature3_img: '',
        feature4_img: ''
      }
    }
  },
  {
    key: 'page_main_card1_text',
    category: 'landing',
    title: 'Main Page Team Card Text 1',
    content: '"I GOT 99 PROBLEMS BUT WINNING AIN\'T ONE"',
    metadata: {}
  },
  {
    key: 'page_main_card2_text',
    category: 'landing',
    title: 'Main Page Hub Banner Text 2',
    content: 'CHAMPION FOOTBALLER IS YOUR ULTIMATE HUB FOR FOOTBALL, PERFORMANCE, AND BRAGGING RIGHTS!',
    metadata: {}
  },
  {
    key: 'page_main_feature1_title',
    category: 'landing',
    title: 'Main Page Feature Card 1 Title',
    content: 'CREATE YOUR PLAYER CARD',
    metadata: {}
  },
  {
    key: 'page_main_feature2_title',
    category: 'landing',
    title: 'Main Page Feature Card 2 Title',
    content: 'CREATE LEAGUES & MATCHES',
    metadata: {}
  },
  {
    key: 'page_main_feature3_title',
    category: 'landing',
    title: 'Main Page Feature Card 3 Title',
    content: 'TRACK YOUR PERFORMANCE',
    metadata: {}
  },
  {
    key: 'page_main_feature4_title',
    category: 'landing',
    title: 'Main Page Feature Card 4 Title',
    content: 'WIN TROPHIES & REWARDS',
    metadata: {}
  },
  {
    key: 'page_auth_login_btn',
    category: 'landing',
    title: 'Main Landing Sign In Button Label',
    content: 'SIGN IN',
    metadata: {}
  },
  {
    key: 'page_auth_forgot_pw_link',
    category: 'landing',
    title: 'Main Landing Forgot Password Link Text',
    content: 'Forgot your password?',
    metadata: {}
  },
  {
    key: 'page_auth_terms_label',
    category: 'landing',
    title: 'Main Landing Terms Checkbox Text',
    content: 'I accept the terms and conditions',
    metadata: {}
  },
  {
    key: 'page_auth_register_btn',
    category: 'landing',
    title: 'Main Landing Register Button Label',
    content: 'Register',
    metadata: {}
  },

  // --- PLATFORM PAGES STATIC CONTENT INFO BANNERS ---

  {
    key: 'page_all_matches_heading',
    category: 'matches',
    title: 'All Matches Main Heading',
    content: 'Matches',
    metadata: {}
  },
  {
    key: 'page_all_matches_new_btn',
    category: 'matches',
    title: 'All Matches New Match Button',
    content: '+ New Match',
    metadata: {}
  },
  {
    key: 'page_all_matches_year_placeholder',
    category: 'matches',
    title: 'All Matches Year Filter Label',
    content: 'All Years',
    metadata: {}
  },
  {
    key: 'page_all_matches_league_placeholder',
    category: 'matches',
    title: 'All Matches Select League Label',
    content: 'Select League',
    metadata: {}
  },
  {
    key: 'page_all_matches_season_placeholder',
    category: 'matches',
    title: 'All Matches Select Season Label',
    content: 'All Seasons',
    metadata: {}
  },
  {
    key: 'page_all_matches_clear_btn',
    category: 'matches',
    title: 'All Matches Clear Filter Button',
    content: 'Clear',
    metadata: {}
  },
  {
    key: 'page_all_matches_results_tab',
    category: 'matches',
    title: 'All Matches Results Tab Label',
    content: 'Results',
    metadata: {}
  },
  {
    key: 'page_all_matches_fixtures_tab',
    category: 'matches',
    title: 'All Matches Fixtures Tab Label',
    content: 'Fixtures',
    metadata: {}
  },
  {
    key: 'page_all_matches_archived_tab',
    category: 'matches',
    title: 'All Matches Archived Tab Label',
    content: 'Archived',
    metadata: {}
  },
  {
    key: 'page_all_matches_all_tab',
    category: 'matches',
    title: 'All Matches All Tab Label',
    content: 'All Matches',
    metadata: {}
  },
  {
    key: 'page_all_players_heading',
    category: 'players',
    title: 'All Players Main Heading',
    content: 'ALL PLAYERS',
    metadata: {}
  },
  {
    key: 'page_all_players_search_placeholder',
    category: 'players',
    title: 'All Players Search Input Placeholder',
    content: 'Search Player by name...',
    metadata: {}
  },
  {
    key: 'page_all_players_year_placeholder',
    category: 'players',
    title: 'All Players Year Filter Label',
    content: 'All Years',
    metadata: {}
  },
  {
    key: 'page_all_players_league_placeholder',
    category: 'players',
    title: 'All Players Select League Label',
    content: 'Select League',
    metadata: {}
  },
  {
    key: 'page_all_players_season_placeholder',
    category: 'players',
    title: 'All Players Select Season Label',
    content: 'All Seasons',
    metadata: {}
  },
  {
    key: 'page_all_players_position_placeholder',
    category: 'players',
    title: 'All Players Position Filter Label',
    content: 'All Positions',
    metadata: {}
  },
  {
    key: 'page_all_players_clear_btn',
    category: 'players',
    title: 'All Players Clear Filter Button',
    content: 'Clear',
    metadata: {}
  },
  {
    key: 'page_player_stats_heading',
    category: 'player_stats',
    title: 'Player Stats Main Heading',
    content: 'PLAYER STATS',
    metadata: {}
  },
  {
    key: 'page_player_stats_search_placeholder',
    category: 'player_stats',
    title: 'Player Stats Search Input Placeholder',
    content: 'Search player name and hit enter...',
    metadata: {}
  },
  {
    key: 'page_player_stats_year_placeholder',
    category: 'player_stats',
    title: 'Player Stats Year Filter Label',
    content: 'All Years',
    metadata: {}
  },
  {
    key: 'page_player_stats_league_placeholder',
    category: 'player_stats',
    title: 'Player Stats Select League Label',
    content: 'Select League',
    metadata: {}
  },
  {
    key: 'page_player_stats_season_placeholder',
    category: 'player_stats',
    title: 'Player Stats Select Season Label',
    content: 'All Seasons',
    metadata: {}
  },
  {
    key: 'page_player_stats_clear_btn',
    category: 'player_stats',
    title: 'Player Stats Clear Filter Button',
    content: 'Clear',
    metadata: {}
  },
  // Navigation Tabs
  {
    key: 'page_player_stats_tab_current',
    category: 'player_stats',
    title: 'Player Stats Current Tab Label',
    content: 'Current',
    metadata: {}
  },
  {
    key: 'page_player_stats_tab_career',
    category: 'player_stats',
    title: 'Player Stats Career Stats Tab Label',
    content: 'Career Stats',
    metadata: {}
  },
  {
    key: 'page_player_stats_tab_trophies',
    category: 'player_stats',
    title: 'Player Stats Trophies Tab Label',
    content: 'Trophies',
    metadata: {}
  },
  {
    key: 'page_player_stats_tab_rewards',
    category: 'player_stats',
    title: 'Player Stats Rewards Tab Label',
    content: 'Rewards',
    metadata: {}
  },
  {
    key: 'page_player_stats_tab_history',
    category: 'player_stats',
    title: 'Player Stats History Tab Label',
    content: 'History',
    metadata: {}
  },
  // Stats Summary Row
  {
    key: 'page_player_stats_label_apps',
    category: 'player_stats',
    title: 'Player Stats APPS Label',
    content: 'APPS',
    metadata: {}
  },
  {
    key: 'page_player_stats_label_goals',
    category: 'player_stats',
    title: 'Player Stats GOALS Label',
    content: 'GOALS',
    metadata: {}
  },
  {
    key: 'page_player_stats_label_assists',
    category: 'player_stats',
    title: 'Player Stats ASSISTS Label',
    content: 'ASSISTS',
    metadata: {}
  },
  {
    key: 'page_player_stats_label_motm',
    category: 'player_stats',
    title: 'Player Stats MOTM VOTES Label',
    content: 'MOTM VOTES',
    metadata: {}
  },
  {
    key: 'page_player_stats_label_defensive',
    category: 'player_stats',
    title: 'Player Stats DEFENSIVE IMP. Label',
    content: 'DEFENSIVE IMP.',
    metadata: {}
  },
  {
    key: 'page_player_stats_label_cleansheet',
    category: 'player_stats',
    title: 'Player Stats CLEAN SHEET Label',
    content: 'CLEAN SHEET',
    metadata: {}
  },
  {
    key: 'page_player_stats_label_totalxp',
    category: 'player_stats',
    title: 'Player Stats TOTAL XP Label',
    content: 'TOTAL XP',
    metadata: {}
  },
  // Trophies Card
  {
    key: 'page_player_stats_trophies_title',
    category: 'player_stats',
    title: 'Trophies & Awards Section Title',
    content: 'Trophies & Awards',
    metadata: {}
  },
  {
    key: 'page_player_stats_trophies_empty',
    category: 'player_stats',
    title: 'Trophies Empty Text',
    content: 'No trophies yet',
    metadata: {}
  },
  // Rewards Card
  {
    key: 'page_player_stats_rewards_title',
    category: 'player_stats',
    title: 'Rewards XP Section Title',
    content: 'Rewards XP',
    metadata: {}
  },
  {
    key: 'page_player_stats_rewards_empty',
    category: 'player_stats',
    title: 'Rewards Empty Text',
    content: 'No rewards earned yet',
    metadata: {}
  },
  // History & Records Card
  {
    key: 'page_player_stats_history_title',
    category: 'player_stats',
    title: 'History & Records Section Title',
    content: 'History & Records',
    metadata: {}
  },
  {
    key: 'page_player_stats_history_win_streak',
    category: 'player_stats',
    title: 'Longest Win Streak Label',
    content: 'Longest Win Streak',
    metadata: {}
  },
  {
    key: 'page_player_stats_history_most_goals',
    category: 'player_stats',
    title: 'Most Goals Scored In A League Label',
    content: 'Most Goals Scored In A League',
    metadata: {}
  },
  {
    key: 'page_player_stats_history_most_motm',
    category: 'player_stats',
    title: 'Most MOTM Votes Received In A League Label',
    content: 'Most MOTM Votes Received In A League',
    metadata: {}
  },
  {
    key: 'page_player_stats_history_win_margin',
    category: 'player_stats',
    title: 'Largest Win Margin Label',
    content: 'Largest Win Margin',
    metadata: {}
  },
  {
    key: 'page_player_stats_history_highest_xp',
    category: 'player_stats',
    title: 'Highest XP Points Received In A League Label',
    content: 'Highest XP Points Received In A League',
    metadata: {}
  },
  {
    key: 'page_league_details_info',
    category: 'leagues',
    title: 'League Details Info Banner',
    content: 'Welcome to the League overview! View members, manage settings, and check standings.',
    metadata: {}
  },
  {
    key: 'league_details_info',
    category: 'leagues',
    title: 'League Details Info Banner (Legacy)',
    content: 'Welcome to the League overview! View members, manage settings, and check standings.',
    metadata: {}
  },
  {
    key: 'player_career_heading',
    category: 'career',
    title: 'Player Career Main Heading',
    content: 'PERFORMANCE DASHBOARD',
    metadata: {}
  },
  {
    key: 'page_player_career_heading',
    category: 'career',
    title: 'Player Career Heading (Page)',
    content: 'PERFORMANCE DASHBOARD',
    metadata: {}
  },
  {
    key: 'page_player_career_total_xp_legend',
    category: 'career',
    title: 'Player Career Total XP Chart Legend',
    content: 'Total XP Points',
    metadata: {}
  },
  {
    key: 'page_player_career_cumulative_xp_legend',
    category: 'career',
    title: 'Player Career Cumulative XP Chart Legend',
    content: 'Cumulative XP Points',
    metadata: {}
  },
  {
    key: 'page_player_career_influence_all_leagues_btn',
    category: 'career',
    title: 'Player Career All Leagues Filter Button',
    content: 'All Leagues',
    metadata: {}
  },
  {
    key: 'page_player_career_influence_current_btn',
    category: 'career',
    title: 'Player Career Current Filter Button',
    content: 'Current',
    metadata: {}
  },
  {
    key: 'page_player_career_search_placeholder',
    category: 'career',
    title: 'Player Career Search Input Placeholder',
    content: 'Search player name and hit enter...',
    metadata: {}
  },
  {
    key: 'page_player_career_year_placeholder',
    category: 'career',
    title: 'Player Career Year Filter Label',
    content: 'All Years',
    metadata: {}
  },
  {
    key: 'page_player_career_league_placeholder',
    category: 'career',
    title: 'Player Career Select League Label',
    content: 'Select League',
    metadata: {}
  },
  {
    key: 'page_player_career_season_placeholder',
    category: 'career',
    title: 'Player Career Select Season Label',
    content: 'All Seasons',
    metadata: {}
  },
  {
    key: 'page_player_career_clear_btn',
    category: 'career',
    title: 'Player Career Clear Filter Button',
    content: 'Clear',
    metadata: {}
  },
  {
    key: 'page_player_career_influence_title',
    category: 'career',
    title: 'Player Career Influence Card Title',
    content: 'INFLUENCE',
    metadata: {}
  },
  {
    key: 'page_player_career_winloss_title',
    category: 'career',
    title: 'Player Career Win/Loss/Draw Title',
    content: 'WIN/LOSS/DRAW',
    metadata: {}
  },
  {
    key: 'page_player_career_impact_title',
    category: 'career',
    title: 'Player Career Impact Section Title',
    content: 'IMPACT',
    metadata: {}
  },
  {
    key: 'page_player_career_strengths_title',
    category: 'career',
    title: 'Player Career Top Strengths Section Title',
    content: 'YOUR TOP STRENGTHS',
    metadata: {}
  },
  {
    key: 'page_player_career_focus_title',
    category: 'career',
    title: 'Player Career Focus Area Section Title',
    content: 'FOCUS AREA',
    metadata: {}
  },
  {
    key: 'page_player_career_table_header_metric',
    category: 'career',
    title: 'Player Career Table Metric Header',
    content: 'Metric',
    metadata: {}
  },
  {
    key: 'page_player_career_table_header_your_stats',
    category: 'career',
    title: 'Player Career Table Your Stats Header',
    content: 'Your Stats',
    metadata: {}
  },
  {
    key: 'page_player_career_table_header_league_avg',
    category: 'career',
    title: 'Player Career Table League Average Header',
    content: 'League Average',
    metadata: {}
  },
  {
    key: 'page_player_career_xg_label',
    category: 'career',
    title: 'Player Career Expected Goals Metric Label',
    content: 'Expected to score a goal (xG)',
    metadata: {}
  },
  {
    key: 'page_player_career_xa_label',
    category: 'career',
    title: 'Player Career Expected Assists Metric Label',
    content: 'Expected to assist a goal (xA)',
    metadata: {}
  },
  {
    key: 'page_player_career_xcs_label',
    category: 'career',
    title: 'Player Career Expected Clean Sheet Metric Label',
    content: 'Expected to keep Clean Sheet (xCS)',
    metadata: {}
  },
  {
    key: 'page_player_career_winrate_label',
    category: 'career',
    title: 'Player Career Win Rate Metric Label',
    content: 'Win rate',
    metadata: {}
  },
  {
    key: 'page_player_career_strengths_empty',
    category: 'career',
    title: 'Player Career Strengths Empty State Text',
    content: 'No strengths identified yet. Play more matches to unlock your strengths.',
    metadata: {}
  },
  {
    key: 'page_player_career_key_insight_title',
    category: 'career',
    title: 'Player Career Key Insight Header',
    content: 'Key Insight / Top Strength',
    metadata: {}
  },
  {
    key: 'page_player_career_metric_goals',
    category: 'career',
    title: 'Player Career Metric Goals Label',
    content: 'Goals',
    metadata: {}
  },
  {
    key: 'page_player_career_metric_assists',
    category: 'career',
    title: 'Player Career Metric Assists Label',
    content: 'Assists',
    metadata: {}
  },
  {
    key: 'page_player_career_metric_clean_sheets',
    category: 'career',
    title: 'Player Career Metric Clean Sheets Label',
    content: 'Clean Sheets',
    metadata: {}
  },
  {
    key: 'page_player_career_metric_motm_votes',
    category: 'career',
    title: 'Player Career Metric MOTM Votes Label',
    content: 'MOTM Votes',
    metadata: {}
  },
  {
    key: 'page_player_career_metric_defensive_impact_votes',
    category: 'career',
    title: 'Player Career Metric Defensive Impact Votes Label',
    content: 'Defensive Impact Votes',
    metadata: {}
  },
  {
    key: 'page_player_career_metric_game_contribution_index',
    category: 'career',
    title: 'Player Career Metric Game Contribution Index Label',
    content: 'Game Contribution Index',
    metadata: {}
  },
  {
    key: 'page_player_career_metric_captains_performance',
    category: 'career',
    title: 'Player Career Metric Captains Performance Label',
    content: 'Captains Performance',
    metadata: {}
  },
  {
    key: 'page_player_career_metric_wins',
    category: 'career',
    title: 'Player Career Metric Wins Label',
    content: 'Wins',
    metadata: {}
  },
  {
    key: 'page_player_career_metric_pct_impact',
    category: 'career',
    title: 'Player Career Metric % Impact Label',
    content: '% Impact',
    metadata: {}
  },
  // --- TROPHY ROOM PAGE STATIC CONTENT ---
  {
    key: 'page_trophy_room_heading',
    category: 'trophy',
    title: 'Trophy Room Main Heading',
    content: 'TROPHY ROOM',
    metadata: {}
  },
  {
    key: 'page_trophy_room_standings_label',
    category: 'trophy',
    title: 'Trophy Room Standings Label',
    content: 'Standings:',
    metadata: {}
  },
  {
    key: 'page_trophy_room_last_updated_label',
    category: 'trophy',
    title: 'Trophy Room Last Updated Label',
    content: 'Last Updated:',
    metadata: {}
  },
  {
    key: 'page_trophy_room_year_placeholder',
    category: 'trophy',
    title: 'Trophy Room Year Filter Label',
    content: 'All Years',
    metadata: {}
  },
  {
    key: 'page_trophy_room_league_placeholder',
    category: 'trophy',
    title: 'Trophy Room Select League Label',
    content: 'Select League',
    metadata: {}
  },
  {
    key: 'page_trophy_room_season_placeholder',
    category: 'trophy',
    title: 'Trophy Room Select Season Label',
    content: 'All Seasons',
    metadata: {}
  },
  {
    key: 'page_trophy_room_clear_btn',
    category: 'trophy',
    title: 'Trophy Room Clear Filter Button',
    content: 'Clear',
    metadata: {}
  },
  {
    key: 'page_trophy_room_tab_league',
    category: 'trophy',
    title: 'Trophy Room League Awards Tab Label',
    content: 'LEAGUE AWARDS',
    metadata: {}
  },
  {
    key: 'page_trophy_room_tab_achievements',
    category: 'trophy',
    title: 'Trophy Room Achievements Tab Label',
    content: 'Achievements',
    metadata: {}
  },
  {
    key: 'page_trophy_room_league_awards_title',
    category: 'trophy',
    title: 'League Awards Section Title',
    content: 'LEAGUE AWARDS',
    metadata: {}
  },
  {
    key: 'page_trophy_room_individual_awards_title',
    category: 'trophy',
    title: 'Individual Awards Section Title',
    content: 'INDIVIDUAL AWARDS',
    metadata: {}
  },
  // --- MY PROFILE PAGE STATIC CONTENT ---
  {
    key: 'page_profile_heading',
    category: 'profile',
    title: 'My Profile Main Heading',
    content: 'MY PROFILE',
    metadata: {}
  },
  {
    key: 'page_profile_images',
    category: 'profile',
    title: 'Profile Page All Skill & Section Images (Overview)',
    content: '',
    metadata: {
      stepImages: {
        dribbling: '',
        shooting: '',
        passing: '',
        pace: '',
        defending: '',
        physical: '',
        avatar: '',
        step1: '',
        step2: '',
        step3: ''
      }
    }
  },
  {
    key: 'page_profile_step1_title',
    category: 'profile',
    title: 'Step 1 Stepper Label (Personal Details)',
    content: 'PERSONAL DETAILS',
    metadata: {}
  },
  {
    key: 'page_profile_step2_title',
    category: 'profile',
    title: 'Step 2 Stepper Label (Skills & Attributes)',
    content: 'SKILLS & ATTRIBUTES',
    metadata: {}
  },
  {
    key: 'page_profile_step3_title',
    category: 'profile',
    title: 'Step 3 Stepper Label (Brief Details)',
    content: 'BRIEF DETAILS',
    metadata: {}
  },
  {
    key: 'page_profile_skills_title',
    category: 'profile',
    title: 'Skills Overview Section Title',
    content: 'Skills Overview',
    metadata: {}
  },
  {
    key: 'page_profile_btn_home',
    category: 'profile',
    title: 'Home Button Label',
    content: 'Home',
    metadata: {}
  },
  {
    key: 'page_profile_btn_edit',
    category: 'profile',
    title: 'Edit Profile Button Label',
    content: 'Edit Profile',
    metadata: {}
  },
  {
    key: 'page_profile_btn_save',
    category: 'profile',
    title: 'Save Profile Button Label',
    content: 'Save Profile',
    metadata: {}
  },
  {
    key: 'page_profile_btn_back',
    category: 'profile',
    title: 'Back Button Label',
    content: 'Back',
    metadata: {}
  },
  {
    key: 'page_profile_label_age',
    category: 'profile',
    title: 'Age Label',
    content: 'Age:',
    metadata: {}
  },
  {
    key: 'page_profile_label_email',
    category: 'profile',
    title: 'Email Label',
    content: 'Email:',
    metadata: {}
  },
  {
    key: 'page_profile_label_foot',
    category: 'profile',
    title: 'Preferred Foot Label',
    content: 'Foot:',
    metadata: {}
  },
  {
    key: 'page_profile_label_phone',
    category: 'profile',
    title: 'Phone Label',
    content: 'Phone:',
    metadata: {}
  },
  // --- STEP 2: BRIEF DETAILS FIELDS ---
  {
    key: 'page_profile_brief_title',
    category: 'profile',
    title: 'Brief Details Section Title',
    content: 'BRIEF DETAILS',
    metadata: {}
  },
  {
    key: 'page_profile_label_firstname',
    category: 'profile',
    title: 'First Name Input Label',
    content: 'First Name',
    metadata: {}
  },
  {
    key: 'page_profile_label_lastname',
    category: 'profile',
    title: 'Last Name Input Label',
    content: 'Last Name',
    metadata: {}
  },
  {
    key: 'page_profile_label_email_input',
    category: 'profile',
    title: 'Email Input Label',
    content: 'Email',
    metadata: {}
  },
  {
    key: 'page_profile_label_password',
    category: 'profile',
    title: 'Change Password Label',
    content: 'Change Password',
    metadata: {}
  },
  {
    key: 'page_profile_label_country',
    category: 'profile',
    title: 'Country/Region Input Label',
    content: 'Country/Region',
    metadata: {}
  },
  {
    key: 'page_profile_label_city',
    category: 'profile',
    title: 'City/State Input Label',
    content: 'City/State',
    metadata: {}
  },
  {
    key: 'page_profile_label_phone_input',
    category: 'profile',
    title: 'Phone Number Input Label',
    content: 'Phone Number',
    metadata: {}
  },
  {
    key: 'page_profile_label_age_input',
    category: 'profile',
    title: 'Age Input Label',
    content: 'Age',
    metadata: {}
  },
  {
    key: 'page_profile_label_gender',
    category: 'profile',
    title: 'Gender Input Label',
    content: 'Gender',
    metadata: {}
  },
  {
    key: 'page_profile_label_foot_input',
    category: 'profile',
    title: 'Preferred Foot Input Label',
    content: 'Preferred Foot',
    metadata: {}
  },
  {
    key: 'page_profile_label_position_type',
    category: 'profile',
    title: 'Position Type Label',
    content: 'Position Type',
    metadata: {}
  },
  {
    key: 'page_profile_label_specific_position',
    category: 'profile',
    title: 'Specific Position Label',
    content: 'Specific Position',
    metadata: {}
  },
  {
    key: 'page_profile_label_playing_style',
    category: 'profile',
    title: 'Playing Style Label',
    content: 'Playing Style',
    metadata: {}
  },
  {
    key: 'page_profile_btn_update',
    category: 'profile',
    title: 'Update Profile Button Label',
    content: 'Update Profile',
    metadata: {}
  },
  {
    key: 'page_profile_btn_previous',
    category: 'profile',
    title: 'Previous Button Label',
    content: 'Previous',
    metadata: {}
  },
  {
    key: 'page_profile_btn_delete',
    category: 'profile',
    title: 'Delete Account Button Label',
    content: 'Delete Account',
    metadata: {}
  },
  // --- STEP 3: SKILLS & ATTRIBUTES ---
  {
    key: 'page_profile_skills_step_title',
    category: 'profile',
    title: 'Skills & Attributes Section Title',
    content: 'SKILLS & ATTRIBUTES',
    metadata: {}
  },
  {
    key: 'page_profile_skill_dribbling',
    category: 'profile',
    title: 'Dribbling Skill Name',
    content: 'Dribbling',
    metadata: {}
  },
  {
    key: 'page_profile_skill_shooting',
    category: 'profile',
    title: 'Shooting Skill Name',
    content: 'Shooting',
    metadata: {}
  },
  {
    key: 'page_profile_skill_passing',
    category: 'profile',
    title: 'Passing Skill Name',
    content: 'Passing',
    metadata: {}
  },
  {
    key: 'page_profile_skill_pace',
    category: 'profile',
    title: 'Pace Skill Name',
    content: 'Pace',
    metadata: {}
  },
  {
    key: 'page_profile_skill_defending',
    category: 'profile',
    title: 'Defending Skill Name',
    content: 'Defending',
    metadata: {}
  },
  {
    key: 'page_profile_skill_physical',
    category: 'profile',
    title: 'Physical Skill Name',
    content: 'Physical',
    metadata: {}
  },
  {
    key: 'page_profile_btn_next',
    category: 'profile',
    title: 'Next Button Label',
    content: 'Next',
    metadata: {}
  },
  // --- PROFILE STATIC IMAGES ---
  {
    key: 'page_profile_img_dribbling',
    category: 'profile',
    title: 'Dribbling Skill Icon/Image',
    content: '/images/Dribbling.png',
    metadata: {}
  },
  {
    key: 'page_profile_img_shooting',
    category: 'profile',
    title: 'Shooting Skill Icon/Image',
    content: '/images/shooting.png',
    metadata: {}
  },
  {
    key: 'page_profile_img_passing',
    category: 'profile',
    title: 'Passing Skill Icon/Image',
    content: '/images/passing.png',
    metadata: {}
  },
  {
    key: 'page_profile_img_pace',
    category: 'profile',
    title: 'Pace Skill Icon/Image',
    content: '/images/pace.png',
    metadata: {}
  },
  {
    key: 'page_profile_img_defending',
    category: 'profile',
    title: 'Defending Skill Icon/Image',
    content: '/images/defending.png',
    metadata: {}
  },
  {
    key: 'page_profile_img_physical',
    category: 'profile',
    title: 'Physical Skill Icon/Image',
    content: '/images/physical.png',
    metadata: {}
  },

  // --- ALL LEAGUES PAGE & SETTINGS POPUP STATIC CONTENT ---
  {
    key: 'page_all_leagues_heading',
    category: 'leagues',
    title: 'All Leagues Main Heading',
    content: 'LEAGUES',
    metadata: {}
  },
  {
    key: 'page_all_leagues_create_btn',
    category: 'leagues',
    title: 'All Leagues Create Button',
    content: '+ Create New League',
    metadata: {}
  },
  {
    key: 'page_all_leagues_join_placeholder',
    category: 'leagues',
    title: 'All Leagues Join Input Placeholder',
    content: 'Enter invite code',
    metadata: {}
  },
  {
    key: 'page_all_leagues_join_btn',
    category: 'leagues',
    title: 'All Leagues Join Button',
    content: 'Join League',
    metadata: {}
  },
  {
    key: 'page_all_leagues_year_placeholder',
    category: 'leagues',
    title: 'All Leagues Year Filter Label',
    content: 'All Years',
    metadata: {}
  },
  {
    key: 'page_all_leagues_select_placeholder',
    category: 'leagues',
    title: 'All Leagues Filter Dropdown Label',
    content: 'All Leagues',
    metadata: {}
  },
  {
    key: 'page_all_leagues_clear_btn',
    category: 'leagues',
    title: 'All Leagues Filter Clear Button',
    content: 'Clear',
    metadata: {}
  },
  {
    key: 'page_all_leagues_live_tab',
    category: 'leagues',
    title: 'All Leagues Live Tab Label',
    content: 'Current / Live Leagues',
    metadata: {}
  },
  {
    key: 'page_all_leagues_completed_tab',
    category: 'leagues',
    title: 'All Leagues Completed Tab Label',
    content: 'Completed Leagues',
    metadata: {}
  },
  {
    key: 'page_all_leagues_card_players_label',
    category: 'leagues',
    title: 'League Card Players Label',
    content: 'Players',
    metadata: {}
  },
  {
    key: 'page_all_leagues_card_matches_label',
    category: 'leagues',
    title: 'League Card Matches Label',
    content: 'Total Matches:',
    metadata: {}
  },
  {
    key: 'page_all_leagues_card_invite_label',
    category: 'leagues',
    title: 'League Card Invite Code Label',
    content: 'Invite Code:',
    metadata: {}
  },
  {
    key: 'page_all_leagues_card_admin_label',
    category: 'leagues',
    title: 'League Card Admin Label',
    content: 'League Admin:',
    metadata: {}
  },
  {
    key: 'page_all_leagues_card_view_btn',
    category: 'leagues',
    title: 'League Card View Button Label',
    content: 'View',
    metadata: {}
  },
  {
    key: 'modal_create_league_title',
    category: 'leagues',
    title: 'Create League Modal Title',
    content: 'Create New League',
    metadata: {}
  },
  {
    key: 'modal_create_league_subtitle',
    category: 'leagues',
    title: 'Create League Modal Subtitle',
    content: 'Fill in the details below to set up your new football league',
    metadata: {}
  },
  {
    key: 'modal_create_league_name_label',
    category: 'leagues',
    title: 'Create League Name Input Label',
    content: 'League Name',
    metadata: {}
  },
  {
    key: 'modal_create_league_submit_btn',
    category: 'leagues',
    title: 'Create League Submit Button',
    content: 'Create League',
    metadata: {}
  },
  {
    key: 'modal_league_details_members_tab',
    category: 'leagues',
    title: 'League Details Popup Members Tab',
    content: 'League Members',
    metadata: {}
  },
  {
    key: 'modal_league_details_leave_season_btn',
    category: 'leagues',
    title: 'League Details Popup Leave Season Button',
    content: 'Leave Season',
    metadata: {}
  },
  {
    key: 'modal_league_details_leave_league_btn',
    category: 'leagues',
    title: 'League Details Popup Leave League Button',
    content: 'Leave League',
    metadata: {}
  },
  {
    key: 'modal_league_details_settings_btn',
    category: 'leagues',
    title: 'League Details Popup Settings Button',
    content: 'League Settings',
    metadata: {}
  },
  {
    key: 'modal_league_settings_title',
    category: 'leagues',
    title: 'League Settings Sub-Modal Title',
    content: 'League Settings',
    metadata: {}
  },
  {
    key: 'modal_league_settings_save_btn',
    category: 'leagues',
    title: 'League Settings Save Button',
    content: 'Save Changes',
    metadata: {}
  },
  {
    key: 'modal_league_settings_cancel_btn',
    category: 'leagues',
    title: 'League Settings Cancel Button',
    content: 'Cancel',
    metadata: {}
  },
  {
    key: 'page_all_leagues_archived_heading',
    category: 'leagues',
    title: 'Archived Leagues Section Heading',
    content: 'ARCHIVED LEAGUES & SEASONS',
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
let seedPromise: Promise<void> | null = null;

/**
 * Helper: Auto-seed Super Admin user & default static content
 */
export const ensureDefaultsExist = async () => {
  if (hasSeeded) return;
  if (seedPromise) {
    await seedPromise;
    return;
  }

  seedPromise = (async () => {
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

      // 1. Ensure Default Admin User Exists
      const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@championfootballer.co.uk';
      const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@123456';
      let adminUser = await User.findOne({ where: { email: adminEmail } });

      if (!adminUser) {
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
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

      // 2. Clean up obsolete banner static content items (do NOT put active keys here)
      await StaticContent.destroy({
        where: {
          key: [
            'announcement_banner', 'app_rules', 'faq', 'all_leagues_info', 'page_all_leagues_subtitle',
            'all_matches_info', 'page_all_matches_subtitle', 'all_players_info', 'player_card_info',
            'player_stats_info', 'player_career_info', 'trophy_room_info', 'profile_page_info',
            'rewards_info', 'reward_hat_trick_hero', 'reward_captain_leader', 'reward_assist_king',
            'reward_goal_machine', 'reward_defensive_wall', 'reward_motm_master', 'reward_clean_sheet',
            'reward_iron_will', 'reward_invincible_streak',
            'page_profile_default_avatar_image', 'page_profile_skill_dribbling_image',
            'page_profile_skill_shooting_image', 'page_profile_skill_passing_image',
            'page_profile_skill_pace_image', 'page_profile_skill_defending_image',
            'page_profile_skill_physical_image', 'page_profile_step1_image',
            'page_profile_step2_image', 'page_profile_step3_image'
          ]
        }
      });

      // Ensure categories for general, landing, and player_stats items are updated if needed
      await StaticContent.update(
        { category: 'general' },
        { where: { key: ['terms_conditions', 'privacy_policy', 'contact_details', 'game_rules', 'xp_status'] } }
      );
      await StaticContent.update(
        { category: 'footer' },
        { where: { key: ['social_media_links'] } }
      );
      await StaticContent.update(
        { category: 'landing' },
        { where: { key: ['page_landing_images', 'page_main_card1_text', 'page_main_card2_text', 'page_main_feature1_title', 'page_main_feature2_title', 'page_main_feature3_title', 'page_main_feature4_title'] } }
      );
      await StaticContent.update(
        { category: 'player_stats' },
        { where: { key: ['player_stats_heading', 'player_stats_info'] } }
      );
      await StaticContent.update(
        { category: 'career' },
        { where: { key: ['player_career_heading'] } }
      );

      // 3. Seed missing Static Content Items safely
      for (const item of DEFAULT_ITEMS) {
        try {
          const existing = await StaticContent.findOne({ where: { key: item.key } });
          if (!existing) {
            await StaticContent.create(item);
            console.log(`🌱 Created static content item: ${item.key}`);
          } else {
            let updated = false;
            if (existing.category !== item.category) {
              existing.category = item.category;
              updated = true;
            }
            if (item.category === 'rewards' || item.key.startsWith('reward_') || (item.key === 'terms_conditions' && existing.content.length < 500)) {
              existing.title = item.title;
              existing.content = item.content;
              updated = true;
            }
            if (updated) {
              await existing.save();
              console.log(`🔄 Updated static content item '${item.key}'`);
            }
          }
        } catch (itemErr) {
          // Ignore duplicate key race condition if item was inserted concurrently
          console.warn(`Seed item '${item.key}' insert skipped or already exists.`);
        }
      }
      hasSeeded = true;
    } catch (err) {
      console.error('StaticContent & Admin seed check failed:', err);
    } finally {
      seedPromise = null;
    }
  })();

  await seedPromise;
};

/**
 * PUBLIC API: Get all active static content (for Mobile App & Web App)
 * GET /api/static-content
 * GET /api/static-content/:key
 */
const OBSOLETE_KEYS = [
  'announcement_banner', 'app_rules', 'faq', 'all_leagues_info', 'page_all_leagues_subtitle',
  'all_matches_info', 'page_all_matches_subtitle', 'all_players_info', 'player_card_info',
  'player_stats_info', 'player_career_info', 'trophy_room_info', 'profile_page_info',
  'rewards_info', 'reward_hat_trick_hero', 'reward_captain_leader', 'reward_assist_king',
  'reward_goal_machine', 'reward_defensive_wall', 'reward_motm_master', 'reward_clean_sheet',
  'reward_iron_will', 'reward_invincible_streak',
  'page_profile_default_avatar_image', 'page_profile_skill_dribbling_image',
  'page_profile_skill_shooting_image', 'page_profile_skill_passing_image',
  'page_profile_skill_pace_image', 'page_profile_skill_defending_image',
  'page_profile_skill_physical_image', 'page_profile_step1_image',
  'page_profile_step2_image', 'page_profile_step3_image',
  'page_profile_img_dribbling', 'page_profile_img_shooting',
  'page_profile_img_passing', 'page_profile_img_pace',
  'page_profile_img_defending', 'page_profile_img_physical'
];

/**
 * PUBLIC API: Get all active static content (for Mobile App & Web App)
 * GET /api/static-content
 * GET /api/static-content/:key
 */
export const getPublicStaticContent = async (ctx: Context) => {
  try {
    ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    ctx.set('Pragma', 'no-cache');
    ctx.set('Expires', '0');
    await StaticContent.destroy({ where: { key: OBSOLETE_KEYS } });
    await ensureDefaultsExist();
    const { key } = ctx.params;

    if (key) {
      if (OBSOLETE_KEYS.includes(key)) {
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
      where: { isActive: true, key: { [Op.notIn]: OBSOLETE_KEYS } },
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
    await StaticContent.destroy({ where: { key: OBSOLETE_KEYS } });
    await StaticContent.update(
      { category: 'footer' },
      { where: { key: ['social_media_links'] } }
    );
    await StaticContent.update(
      { category: 'landing' },
      { where: { key: ['page_landing_images', 'page_main_card1_text', 'page_main_card2_text', 'page_main_feature1_title', 'page_main_feature2_title', 'page_main_feature3_title', 'page_main_feature4_title'] } }
    );
    await ensureDefaultsExist();
    const items = await StaticContent.findAll({
      where: {
        key: { [Op.notIn]: OBSOLETE_KEYS }
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

    const aliasGroupMap: Record<string, string[]> = {
      'page_player_stats_label_assists': ['page_player_career_metric_assists', 'page_player_career_assists'],
      'page_player_career_metric_assists': ['page_player_stats_label_assists', 'page_player_career_assists'],
      'page_player_career_assists': ['page_player_career_metric_assists', 'page_player_stats_label_assists'],

      'page_player_stats_label_goals': ['page_player_career_metric_goals', 'page_player_career_goals'],
      'page_player_career_metric_goals': ['page_player_stats_label_goals', 'page_player_career_goals'],
      'page_player_career_goals': ['page_player_career_metric_goals', 'page_player_stats_label_goals'],

      'page_player_stats_label_cleansheet': ['page_player_career_metric_clean_sheets', 'page_player_career_clean_sheets'],
      'page_player_career_metric_clean_sheets': ['page_player_stats_label_cleansheet', 'page_player_career_clean_sheets'],
      'page_player_career_clean_sheets': ['page_player_career_metric_clean_sheets', 'page_player_stats_label_cleansheet'],

      'page_player_stats_label_motm': ['page_player_career_metric_motm_votes', 'page_player_career_motm_votes'],
      'page_player_career_metric_motm_votes': ['page_player_stats_label_motm', 'page_player_career_motm_votes'],
      'page_player_career_motm_votes': ['page_player_career_metric_motm_votes', 'page_player_stats_label_motm'],

      'page_player_stats_label_defensive': ['page_player_career_metric_defensive_impact_votes', 'page_player_career_defensive_impact_votes'],
      'page_player_career_metric_defensive_impact_votes': ['page_player_stats_label_defensive', 'page_player_career_defensive_impact_votes'],
      'page_player_career_defensive_impact_votes': ['page_player_career_metric_defensive_impact_votes', 'page_player_stats_label_defensive'],

      'page_league_details_info': ['league_details_info'],
      'league_details_info': ['page_league_details_info'],
    };

    if (existing) {
      if (title !== undefined) existing.title = title;
      if (content !== undefined) existing.content = content;
      if (category !== undefined) existing.category = category;
      if (metadata !== undefined) existing.metadata = metadata;
      if (isActive !== undefined) existing.isActive = Boolean(isActive);
      existing.updatedBy = userId;
      await existing.save();

      const aliases = aliasGroupMap[key];
      if (aliases && content !== undefined) {
        for (const ak of aliases) {
          await StaticContent.update({ content }, { where: { key: ak } });
        }
      }

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
