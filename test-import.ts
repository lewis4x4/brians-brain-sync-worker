import tokenService from './src/services/token.service';
import { TokenService } from './src/services/token.service';

console.log('Default export type:', typeof tokenService);
console.log('Default export methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(tokenService)));
console.log('TokenService class:', typeof TokenService);

const instance = new TokenService();
console.log('New instance methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(instance)));
