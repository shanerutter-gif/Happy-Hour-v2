/** Supabase database types — extend as schema evolves */
export interface Database {
  public: {
    Tables: {
      venues: {
        Row: Venue;
        Insert: Partial<Venue>;
        Update: Partial<Venue>;
      };
      profiles: {
        Row: Profile;
        Insert: Partial<Profile>;
        Update: Partial<Profile>;
      };
      check_ins: {
        Row: CheckIn;
        Insert: Partial<CheckIn>;
        Update: Partial<CheckIn>;
      };
      reviews: {
        Row: Review;
        Insert: Partial<Review>;
        Update: Partial<Review>;
      };
      social_posts: {
        Row: SocialPost;
        Insert: Partial<SocialPost>;
        Update: Partial<SocialPost>;
      };
      follows: {
        Row: Follow;
        Insert: Partial<Follow>;
        Update: Partial<Follow>;
      };
      lists: {
        Row: List;
        Insert: Partial<List>;
        Update: Partial<List>;
      };
      list_items: {
        Row: ListItem;
        Insert: Partial<ListItem>;
        Update: Partial<ListItem>;
      };
      dm_threads: {
        Row: DmThread;
        Insert: Partial<DmThread>;
        Update: Partial<DmThread>;
      };
      dm_messages: {
        Row: DmMessage;
        Insert: Partial<DmMessage>;
        Update: Partial<DmMessage>;
      };
      notifications: {
        Row: Notification;
        Insert: Partial<Notification>;
        Update: Partial<Notification>;
      };
      venue_descriptions: {
        Row: VenueDescription;
        Insert: Partial<VenueDescription>;
        Update: Partial<VenueDescription>;
      };
    };
  };
}

export interface Venue {
  id: string;
  name: string;
  type: 'hh' | 'event';
  neighborhood: string;
  city: string;
  address: string;
  lat: number | null;
  lng: number | null;
  when_text: string;
  days: string[];
  deals: string[];
  amenities: string[];
  photo_url: string | null;
  yelp_url: string | null;
  yelp_rating: number | null;
  google_rating: number | null;
  going_count: number;
  review_count: number;
  avg_rating: number | null;
  fire_count: number;
  claimed: boolean;
  featured: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  city: string;
  neighborhood: string | null;
  followers_count: number;
  following_count: number;
  check_in_count: number;
  xp: number;
  level: number;
  streak: number;
  created_at: string;
}

export interface CheckIn {
  id: string;
  user_id: string;
  venue_id: string;
  created_at: string;
  note: string | null;
  photo_url: string | null;
}

export interface Review {
  id: string;
  user_id: string;
  venue_id: string;
  rating: number;
  text: string;
  created_at: string;
}

export interface SocialPost {
  id: string;
  user_id: string;
  venue_id: string | null;
  type: 'check_in' | 'review' | 'photo' | 'fire' | 'going' | 'follow';
  content: string | null;
  photo_url: string | null;
  created_at: string;
  like_count: number;
  comment_count: number;
}

export interface Follow {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface List {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  emoji: string;
  is_public: boolean;
  item_count: number;
  created_at: string;
}

export interface ListItem {
  id: string;
  list_id: string;
  venue_id: string;
  note: string | null;
  created_at: string;
}

export interface DmThread {
  id: string;
  participants: string[];
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface DmMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read: boolean;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  actor_id: string | null;
  venue_id: string | null;
  content: string;
  read: boolean;
  created_at: string;
}

export interface VenueDescription {
  id: string;
  venue_id: string;
  user_id: string;
  text: string;
  tags: string[];
  upvotes: number;
  created_at: string;
}
