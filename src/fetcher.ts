import { 
  fetchAllPagesForUrl as _fetchAllPagesForUrl, 
  publicationLimit as _publicationLimit
} from './services/serper';

// Re-export the functions from the Serper service
export const publicationLimit = _publicationLimit;
export const fetchAllPagesForUrl = _fetchAllPagesForUrl;