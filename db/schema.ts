import { pgTable, uuid, text, timestamp, integer, jsonb, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table (linked to Privy)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  privyUserId: text('privy_user_id').unique().notNull(),
  email: text('email'),
  displayName: text('display_name'),
  pfpUrl: text('pfp_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Projects table
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  appType: text('app_type').default('farcaster').notNull(), // 'farcaster' or 'web3'
  status: text('status').default('active').notNull(), // 'active', 'archived', 'deleted'
  previewUrl: text('preview_url'),
  vercelUrl: text('vercel_url'),
  netlifyUrl: text('netlify_url'),
  farcasterManifest: jsonb('farcaster_manifest'), // Farcaster miniapp manifest JSON
  publishedAt: timestamp('published_at'), // When the app was published to Farcaster
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Project files table
export const projectFiles = pgTable('project_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  filename: text('filename').notNull(),
  content: text('content').notNull(),
  version: integer('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Project patches table (for diff history)
export const projectPatches = pgTable('project_patches', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  patchData: jsonb('patch_data').notNull(), // Unified diff format
  description: text('description'), // User description of the change
  appliedAt: timestamp('applied_at').defaultNow().notNull(),
  revertedAt: timestamp('reverted_at'),
});

// Project deployments table
export const projectDeployments = pgTable('project_deployments', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  platform: text('platform').notNull(), // 'vercel', 'netlify', 'railway'
  deploymentUrl: text('deployment_url').notNull(),
  status: text('status').notNull(), // 'pending', 'success', 'failed'
  buildLogs: text('build_logs'),
  contractAddresses: jsonb('contract_addresses'), // { ContractName: '0x...', ... }
  deployedAt: timestamp('deployed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// User sessions table (for Privy integration)
export const userSessions = pgTable('user_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  sessionToken: text('session_token').unique().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Chat messages table (for project-specific conversations)
export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(), // 'user' or 'ai'
  content: text('content').notNull(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  phase: text('phase'), // 'requirements', 'building', 'editing'
  changedFiles: jsonb('changed_files'), // Array of changed file names
});

// Generation jobs table (for async processing)
export const generationJobs = pgTable('generation_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  appType: text('app_type').default('farcaster').notNull(), // 'farcaster' or 'web3'
  status: text('status').default('pending').notNull(), // 'pending', 'processing', 'completed', 'failed'
  prompt: text('prompt').notNull(),
  context: jsonb('context').notNull(), // Chat history, project info, etc.
  result: jsonb('result'), // Generation result when completed
  error: text('error'), // Error message if failed
  createdAt: timestamp('created_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  expiresAt: timestamp('expires_at').notNull(), // 24 hours from creation
});

// Define relations
export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  sessions: many(userSessions),
  generationJobs: many(generationJobs),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  files: many(projectFiles),
  patches: many(projectPatches),
  deployments: many(projectDeployments),
  chatMessages: many(chatMessages),
}));

export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  project: one(projects, {
    fields: [projectFiles.projectId],
    references: [projects.id],
  }),
}));

export const projectPatchesRelations = relations(projectPatches, ({ one }) => ({
  project: one(projects, {
    fields: [projectPatches.projectId],
    references: [projects.id],
  }),
}));

export const projectDeploymentsRelations = relations(projectDeployments, ({ one }) => ({
  project: one(projects, {
    fields: [projectDeployments.projectId],
    references: [projects.id],
  }),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, {
    fields: [userSessions.userId],
    references: [users.id],
  }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  project: one(projects, {
    fields: [chatMessages.projectId],
    references: [projects.id],
  }),
}));

export const generationJobsRelations = relations(generationJobs, ({ one }) => ({
  user: one(users, {
    fields: [generationJobs.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [generationJobs.projectId],
    references: [projects.id],
  }),
}));
