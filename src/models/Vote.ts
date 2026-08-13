import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey } from 'sequelize';
import sequelize from '../config/database';
import User from './User';
import Match from './Match';

export class Vote extends Model<InferAttributes<Vote>, InferCreationAttributes<Vote>> {
  declare id: CreationOptional<string>;
  declare matchId: ForeignKey<string>;
  declare voterId: ForeignKey<string>;
  declare votedForId: ForeignKey<string>;
  declare category: CreationOptional<string | null>;

  static associate(models: any) {
    Vote.belongsTo(models.Match, {
      foreignKey: 'matchId',
      as: 'votedMatch'
    });

    Vote.belongsTo(models.User, {
      foreignKey: 'voterId',
      as: 'voter'
    });

    Vote.belongsTo(models.User, {
      foreignKey: 'votedForId',
      as: 'votedFor'
    });
  }
}

Vote.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    matchId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'Matches',
        key: 'id',
      },
    },
    voterId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
    },
    votedForId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
    },
    category: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: 'motm',
    },
  },
  {
    sequelize,
    modelName: 'Vote',
    tableName: 'Votes',
    timestamps: true,
  }
);

export default Vote; 