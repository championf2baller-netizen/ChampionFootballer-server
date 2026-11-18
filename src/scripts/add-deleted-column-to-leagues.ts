import sequelize from '../config/database';

async function addDeletedColumn() {
  try {
    await sequelize.query(`
      ALTER TABLE "Leagues" 
      ADD COLUMN IF NOT EXISTS "deleted" BOOLEAN DEFAULT FALSE;
    `);
    console.log('✅ Successfully added "deleted" column to Leagues table');
  } catch (error) {
    console.error('❌ Error adding "deleted" column to Leagues:', error);
  } finally {
    await sequelize.close();
  }
}

addDeletedColumn();
