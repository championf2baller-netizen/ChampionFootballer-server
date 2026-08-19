import { Model, DataTypes } from 'sequelize';
import sequelize from '../config/database';

export interface StaticContentAttributes {
  id?: string;
  key: string;            // e.g. 'app_rules', 'terms_conditions', 'privacy_policy', 'faq', 'announcement_banner', 'contact_details'
  category?: string;      // e.g. 'general', 'legal', 'home', 'rewards'
  title: string;          // Human-readable title
  content: string;        // Main body text/HTML/Markdown
  metadata?: any;         // Additional JSON structure (images, links, sub-fields)
  isActive?: boolean;     // Enable/disable flag
  updatedBy?: string;     // Admin user ID
  createdAt?: Date;
  updatedAt?: Date;
}

export class StaticContent extends Model<StaticContentAttributes> implements StaticContentAttributes {
  public id!: string;
  public key!: string;
  public category!: string;
  public title!: string;
  public content!: string;
  public metadata!: any;
  public isActive!: boolean;
  public updatedBy!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

StaticContent.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'general',
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '',
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'static_contents',
    timestamps: true,
  }
);

export default StaticContent;
