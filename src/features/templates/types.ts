
export interface NetworkTemplate {
    id: string;
    name: string;
    description: string;
    isOfficial: boolean;
    author: string;      // User name
    authorId: string;    // Crucial for Auth rules later
    data: string;        // JSON string of NetworkState
    createdAt: number;
}

export interface User {
    id: string;
    name: string;
    isAdmin: boolean;
}
