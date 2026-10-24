import webpush from 'web-push';

// Generate once, keep the private key with server secrets, and retain both across restarts.
const keys = webpush.generateVAPIDKeys();
console.log(
  `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:you@your-domain.example`,
);
