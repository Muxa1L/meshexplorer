export type NodePosition = {
  node_id: string;
  display_prefix?: string;
  is_repeater?: boolean;
  is_chat_node?: boolean;
  is_room_server?: boolean;
  latitude: number;
  longitude: number;
  altitude?: number;
  last_seen?: string;
  first_seen?: string;
  type?: string;
  short_name?: string;
  name?: string | null;
};
