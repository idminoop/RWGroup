/**
 * local server entry file, for local development
 */
import app from './app.js';

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
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Allow nodemon to restart cleanly without leaving the port occupied.
process.on('SIGUSR2', () => {
  console.log('SIGUSR2 signal received (nodemon restart)');
  server.close(() => {
    console.log('Server closed');
    process.kill(process.pid, 'SIGUSR2');
  });
});

export default app;
