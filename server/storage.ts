import {
  users,
  personaSettings,
  goals,
  conversations,
  messages,
  positions,
  type User,
  type InsertUser,
  type UpsertUser,
  type PersonaSettings,
  type InsertPersonaSettings,
  type Goal,
  type InsertGoal,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";

export type Thinker = {
  id: string;
  name: string;
  title: string;
  description: string;
  icon: string;
};

export interface IStorage {
  // User operations (Replit Auth integration)
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  createUser(user: InsertUser): Promise<User>;
  createOrGetUserByUsername(username: string): Promise<User>;
  getCurrentUser(): Promise<User | undefined>;

  // Persona settings operations
  getPersonaSettings(userId: string): Promise<PersonaSettings | undefined>;
  upsertPersonaSettings(
    userId: string,
    settings: InsertPersonaSettings
  ): Promise<PersonaSettings>;

  // Goals operations
  getGoals(userId: string): Promise<Goal[]>;
  createGoal(userId: string, goal: InsertGoal): Promise<Goal>;
  deleteGoal(id: string, userId: string): Promise<void>;

  // Conversation operations
  getCurrentConversation(userId: string): Promise<Conversation | undefined>;
  getAllConversations(userId: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | undefined>;
  getConversationByTitle(userId: string, title: string): Promise<Conversation | undefined>;
  createConversation(userId: string, conversation: InsertConversation): Promise<Conversation>;
  migrateUserData(fromUserId: string, toUserId: string): Promise<void>;

  // Message operations
  getMessages(conversationId: string): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  deleteMessage(id: string): Promise<void>;

  // Thinker operations (derived from positions table)
  getAllThinkers(): Promise<Thinker[]>;
  getThinker(id: string): Promise<Thinker | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Replit Auth integration
  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createOrGetUserByUsername(username: string): Promise<User> {
    const existingUser = await this.getUserByUsername(username);
    if (existingUser) {
      return existingUser;
    }
    const [newUser] = await db
      .insert(users)
      .values({
        username,
        email: `${username}@askaphilosopher.local`,
        firstName: username,
        lastName: null,
        profileImageUrl: null,
      })
      .returning();
    return newUser;
  }

  async getCurrentUser(): Promise<User | undefined> {
    const [user] = await db.select().from(users).limit(1);
    return user || undefined;
  }

  async getPersonaSettings(userId: string): Promise<PersonaSettings | undefined> {
    const [settings] = await db
      .select()
      .from(personaSettings)
      .where(eq(personaSettings.userId, userId));
    return settings || undefined;
  }

  async upsertPersonaSettings(
    userId: string,
    settings: InsertPersonaSettings
  ): Promise<PersonaSettings> {
    const [result] = await db
      .insert(personaSettings)
      .values({ userId, ...settings })
      .onConflictDoUpdate({
        target: personaSettings.userId,
        set: settings,
      })
      .returning();
    return result;
  }

  async getGoals(userId: string): Promise<Goal[]> {
    return db
      .select()
      .from(goals)
      .where(eq(goals.userId, userId))
      .orderBy(desc(goals.createdAt));
  }

  async createGoal(userId: string, goal: InsertGoal): Promise<Goal> {
    const [result] = await db
      .insert(goals)
      .values({ userId, ...goal })
      .returning();
    return result;
  }

  async deleteGoal(id: string, userId: string): Promise<void> {
    await db
      .delete(goals)
      .where(and(eq(goals.id, id), eq(goals.userId, userId)));
  }

  async getCurrentConversation(userId: string): Promise<Conversation | undefined> {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.createdAt))
      .limit(1);
    return conversation || undefined;
  }

  async getAllConversations(userId: string): Promise<Conversation[]> {
    return db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.createdAt));
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    return conversation || undefined;
  }

  async getConversationByTitle(userId: string, title: string): Promise<Conversation | undefined> {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.title, title)));
    return conversation || undefined;
  }

  async createConversation(
    userId: string,
    conversation: InsertConversation
  ): Promise<Conversation> {
    const [result] = await db
      .insert(conversations)
      .values({ userId, ...conversation })
      .returning();
    return result;
  }

  async migrateUserData(fromUserId: string, toUserId: string): Promise<void> {
    // Migrate conversations from guest to authenticated user
    // (This includes figure conversations which use title "figure:{figureId}")
    await db
      .update(conversations)
      .set({ userId: toUserId })
      .where(eq(conversations.userId, fromUserId));
    
    // Migrate goals
    await db
      .update(goals)
      .set({ userId: toUserId })
      .where(eq(goals.userId, fromUserId));
    
    // Migrate or merge persona settings (prefer existing authenticated user settings)
    const existingSettings = await this.getPersonaSettings(toUserId);
    if (!existingSettings) {
      const guestSettings = await this.getPersonaSettings(fromUserId);
      if (guestSettings) {
        await db
          .update(personaSettings)
          .set({ userId: toUserId })
          .where(eq(personaSettings.userId, fromUserId));
      }
    }
    
    // Clean up the guest user (optional - keep for now)
    // await db.delete(users).where(eq(users.id, fromUserId));
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const [result] = await db.insert(messages).values(message).returning();
    return result;
  }

  async deleteMessage(id: string): Promise<void> {
    await db.delete(messages).where(eq(messages.id, id));
  }

  async getAllThinkers(): Promise<Thinker[]> {
    // Canonical list of valid thinkers - LAST NAMES ONLY (except James Allen, Andrea Dworkin)
    const validThinkers: Record<string, string> = {
      'adler': 'Adler',
      'aesop': 'Aesop',
      'allen': 'James Allen',
      'aristotle': 'Aristotle',
      'bacon': 'Bacon',
      'bergler': 'Bergler',
      'bergson': 'Bergson',
      'berkeley': 'Berkeley',
      'confucius': 'Confucius',
      'darwin': 'Darwin',
      'descartes': 'Descartes',
      'dewey': 'Dewey',
      'dworkin': 'Andrea Dworkin',
      'engels': 'Engels',
      'freud': 'Freud',
      'galileo': 'Galileo',
      'gardner': 'Gardner',
      'goldman': 'Goldman',
      'hegel': 'Hegel',
      'hobbes': 'Hobbes',
      'hume': 'Hume',
      'james': 'James',
      'kant': 'Kant',
      'kernberg': 'Kernberg',
      'kuczynski': 'Kuczynski',
      'la_rochefoucauld': 'La Rochefoucauld',
      'laplace': 'Laplace',
      'le_bon': 'Le Bon',
      'leibniz': 'Leibniz',
      'luther': 'Luther',
      'machiavelli': 'Machiavelli',
      'maimonides': 'Maimonides',
      'marden': 'Marden',
      'marx': 'Marx',
      'mill': 'Mill',
      'nietzsche': 'Nietzsche',
      'peirce': 'Peirce',
      'plato': 'Plato',
      'poincare': 'Poincare',
      'popper': 'Popper',
      'rousseau': 'Rousseau',
      'russell': 'Russell',
      'sartre': 'Sartre',
      'schopenhauer': 'Schopenhauer',
      'smith': 'Smith',
      'spencer': 'Spencer',
      'stekel': 'Stekel',
      'tocqueville': 'Tocqueville',
      'veblen': 'Veblen',
      'weyl': 'Weyl',
      'whewell': 'William Whewell',
    };
    
    // Custom icons for thinkers with uploaded avatars
    const customIcons: Record<string, string> = {
      'adler': '/attached_assets/image_1767740123866.png',
      'aesop': '/attached_assets/image_1767739576464.png',
      'allen': '/attached_assets/image_1767740359663.png',
      'aristotle': '/attached_assets/image_1767739415243.png',
      'bacon': '/attached_assets/image_1767765006309.png',
      'berkeley': '/attached_assets/image_1767766616185.png',
      'bergson': '/attached_assets/image_1767768160273.png',
      'bergler': '/attached_assets/image_1767770923708.png',
      'confucius': '/attached_assets/image_1767764557983.png',
      'darwin': '/attached_assets/image_1767764354902.png',
      'descartes': '/attached_assets/image_1767770332673.png',
      'dewey': '/attached_assets/image_1767770442984.png',
      'dworkin': '/attached_assets/image_1767739326049.png',
      'engels': '/attached_assets/image_1767765355038.png',
      'freud': '/attached_assets/image_1767764671568.png',
      'galileo': '/attached_assets/image_1767765807093.png',
      'gardner': '/attached_assets/GARDNER_1767776759787.png',
      'gibbon': '/attached_assets/image_1767764116587.png',
      'goldman': '/attached_assets/image_1767765250038.png',
      'hegel': '/attached_assets/image_1767765691120.png',
      'hobbes': '/attached_assets/image_1768350602719.png',
      'hume': '/attached_assets/image_1767760752609.png',
      'james': '/attached_assets/WILLIAM_JAMES_1767773951290.png',
      'jung': '/attached_assets/image_1767764454334.png',
      'kant': '/attached_assets/image_1767764009180.png',
      'kernberg': '/attached_assets/image_1767774030569.png',
      'kuczynski': '/attached_assets/image_1767777610408.png',
      'la_rochefoucauld': '/attached_assets/image_1767764852081.png',
      'laplace': '/attached_assets/image_1767766767834.png',
      'le_bon': '/attached_assets/image_1767766966673.png',
      'leibniz': '/attached_assets/image_1767766392846.png',
      'luther': '/attached_assets/image_1768354750287.png',
      'machiavelli': '/attached_assets/image_1768595174245.png',
      'maimonides': '/attached_assets/image_1767776840070.png',
      'marden': '/attached_assets/image_1768589195075.png',
      'marx': '/attached_assets/image_1768596767776.png',
      'mill': '/attached_assets/image_1767826144038.png',
      'nietzsche': '/attached_assets/image_1767765579941.png',
      'newton': '/attached_assets/image_1767766178765.png',
      'plato': '/attached_assets/image_1767770542347.png',
      'peirce': '/attached_assets/PEIRCE_1767776815971.png',
      'poincare': '/attached_assets/poincare.png',
      'popper': '/attached_assets/image_1768118451028.png',
      'rousseau': '/attached_assets/image_1767776779840.png',
      'russell': '/attached_assets/image_1767764261077.png',
      'sartre': '/attached_assets/image_1767766080265.png',
      'schopenhauer': '/attached_assets/image_1768755375392.png',
      'smith': '/attached_assets/image_1767739463034.png',
      'spencer': '/attached_assets/image_1768510766350.png',
      'spinoza': '/attached_assets/image_1767740644054.png',
      'stekel': '/attached_assets/image_1768587725692.png',
      'tocqueville': '/attached_assets/image_1767739940762.png',
      'veblen': '/attached_assets/image_1767774346494.png',
      'weyl': '/attached_assets/WEYL_1767825595904.png',
      'whewell': '/attached_assets/image_1767776961635.png',
    };
    
    // Map database names to canonical IDs (handles duplicates/variations)
    const dbNameToCanonical: Record<string, string> = {
      'adler': 'adler',
      'aesop': 'aesop',
      'aristotle': 'aristotle',
      'bacon': 'bacon',
      'bergler': 'bergler',
      'bergson': 'bergson',
      'berkeley': 'berkeley',
      'confucius': 'confucius',
      'darwin': 'darwin',
      'descartes': 'descartes',
      'dewey': 'dewey',
      'dworkin': 'dworkin',
      'engels': 'engels',
      'freud': 'freud',
      'galileo': 'galileo',
      'gardner': 'gardner',
      'goldman': 'goldman',
      'hegel': 'hegel',
      'hume': 'hume',
      'kant': 'kant',
      'kernberg': 'kernberg',
      'kuczynski': 'kuczynski',
      'Kuczynski': 'kuczynski',
      'le_bon': 'le_bon',
      'leibniz': 'leibniz',
      'machiavelli': 'machiavelli',
      'Machiavelli': 'machiavelli',
      'Niccolo Machiavelli': 'machiavelli',
      'maimonides': 'maimonides',
      'marden': 'marden',
      'Marden': 'marden',
      'Orison Swett Marden': 'marden',
      'marx': 'marx',
      'Marx': 'marx',
      'Karl Marx': 'marx',
      'mill': 'mill',
      'nietzsche': 'nietzsche',
      'peirce': 'peirce',
      'plato': 'plato',
      'popper': 'popper',
      'Popper': 'popper',
      'Karl Popper': 'popper',
      'rousseau': 'rousseau',
      'Rousseau': 'rousseau',
      'russell': 'russell',
      'Russell': 'russell',
      'Mr. Russell': 'russell',
      'sartre': 'sartre',
      'Sartre': 'sartre',
      'Jean-Paul Sartre': 'sartre',
      'schopenhauer': 'schopenhauer',
      'Schopenhauer': 'schopenhauer',
      'Arthur Schopenhauer': 'schopenhauer',
      'stekel': 'stekel',
      'Stekel': 'stekel',
      'Wilhelm Stekel': 'stekel',
      'veblen': 'veblen',
      'weyl': 'weyl',
      'Weyl': 'weyl',
      'whewell': 'whewell',
      'james': 'james',
      'James': 'james',
      'La Rochefoucauld': 'la_rochefoucauld',
    };
    
    // Custom titles for specific thinkers
    const customTitles: Record<string, string> = {
      'kuczynski': 'Epistemic Engineer',
    };
    
    // Build unique list from canonical map
    const thinkers: Thinker[] = Object.entries(validThinkers).map(([id, name]) => ({
      id,
      name,
      title: customTitles[id] || 'Philosopher',
      description: `Philosophical positions and writings of ${name}`,
      icon: customIcons[id] || '',
    }));
    
    const getLastName = (name: string): string => {
      if (name.includes(' Le Bon')) return 'Le Bon';
      if (name.includes(' de La Rochefoucauld')) return 'La Rochefoucauld';
      if (name.includes(' von Mises')) return 'von Mises';
      const parts = name.split(' ');
      return parts[parts.length - 1];
    };
    
    return thinkers.sort((a, b) => 
      getLastName(a.name).localeCompare(getLastName(b.name))
    );
  }

  async getThinker(id: string): Promise<Thinker | undefined> {
    const thinkers = await this.getAllThinkers();
    return thinkers.find(t => t.id === id.toLowerCase());
  }
}

export const storage = new DatabaseStorage();
