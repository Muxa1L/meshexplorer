export type NodePosition = {
  node_id: string;
  display_prefix?: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  last_seen?: string;
  first_seen?: string;
  type?: string;
  short_name?: string;
  name?: string | null;
};
