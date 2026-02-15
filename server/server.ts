/**
 * local server entry file, for local development
 */
import app from './app.js';
import { closeStorage } from './lib/storage.js';
import { stopFeedScheduler } from './lib/feed-scheduler.js';
import { stopBackupScheduler } from './lib/backups.js';

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});

/**
 * close server
 */
function shutdown(signal: string): void {
  console.log(`${signal} signal received`);
  server.close(() => {
    stopFeedScheduler();
    stopBackupScheduler();
    void closeStorage()
      .catch((error) => {
        console.error('Storage close error', error);
      })
      .finally(() => {
        console.log('Server closed');
        process.exit(0);
      });
  });
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

// Allow nodemon to restart cleanly without leaving the port occupied.
process.on('SIGUSR2', () => {
  console.log('SIGUSR2 signal received');
  server.close(() => {
    stopFeedScheduler();
    stopBackupScheduler();
    void closeStorage()
      .catch((error) => {
        console.error('Storage close error', error);
      })
      .finally(() => {
        console.log('Server closed');
        process.kill(process.pid, 'SIGUSR2');
      });
  });
});

export default app;
