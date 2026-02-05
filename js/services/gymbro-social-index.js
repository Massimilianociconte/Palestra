/**
 * Gymbro Social Layer - Service Exports
 * 
 * Central barrel file for all social layer services
 * 
 * @author Gymbro Team
 * @version 1.0.0
 */

// Core Services
export { FriendshipService, friendshipService } from './friendship-service.js';
export { GymbRoomService, gymbRoomService } from './gymbro-room-service.js';
export { GymbRoomRealtimeService, gymbRoomRealtimeService } from './gymbro-realtime-service.js';

// Proximity Detection Services
export { ProximityWebService, proximityWebService } from './proximity-web-service.js';
export { ProximityNativePlugin, proximityNativePlugin } from './proximity-native-plugin.js';

// UI Components
export { GymbRoomUI, createGymbRoomUI } from '../ui/gymbro-room-ui.js';
