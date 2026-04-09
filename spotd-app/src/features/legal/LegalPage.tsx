import { useParams, useNavigate } from 'react-router-dom';
import styles from './LegalPage.module.css';

export default function LegalPage() {
  const { page } = useParams<{ page: string }>();
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </button>
        <span className={styles.headerTitle}>{page === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}</span>
      </div>

      <div className={styles.body}>
        {page === 'privacy' ? <PrivacyContent /> : <TermsContent />}
      </div>
    </div>
  );
}

function PrivacyContent() {
  return (
    <>
      <h2 className={styles.title}>Privacy Policy</h2>
      <p className={styles.effective}>Effective: March 2026</p>
      <div className={styles.legalBody}>
        <p>Spotd ("we", "us", "our") operates the Spotd mobile application and website (spotd.biz). This Privacy Policy explains how we collect, use, and protect your information.</p>
        <h3>Information We Collect</h3>
        <p><strong>Account data:</strong> When you create an account, we collect your email address, display name, and optionally your phone number.</p>
        <p><strong>Location data:</strong> With your permission, we collect your approximate location to show nearby venues and events. We use location only while the app is in use and do not track you in the background.</p>
        <p><strong>Usage data:</strong> We collect information about your interactions with the app, including check-ins, reviews, favorites, and social activity.</p>
        <p><strong>Photos:</strong> If you choose to upload check-in photos, we store them securely in our cloud storage.</p>
        <h3>How We Use Your Information</h3>
        <ul>
          <li>Display nearby happy hours, events, and venues</li>
          <li>Enable social features (check-ins, reviews, messaging)</li>
          <li>Send push notifications you've opted into</li>
          <li>Send promotional SMS messages if you've consented</li>
          <li>Improve the app experience and fix issues</li>
        </ul>
        <h3>Data Sharing</h3>
        <p>We do not sell your personal information. We share data only with:</p>
        <ul>
          <li><strong>Supabase:</strong> Our database and authentication provider</li>
          <li><strong>Google:</strong> If you sign in with Google OAuth</li>
          <li><strong>Apple:</strong> If you sign in with Apple</li>
        </ul>
        <h3>Data Retention &amp; Deletion</h3>
        <p>You can delete your account and all associated data at any time from your Profile Settings. Upon deletion, we remove your profile, reviews, check-ins, messages, and favorites. Some anonymized aggregate data may be retained.</p>
        <h3>Your Rights</h3>
        <p>You may request access to, correction of, or deletion of your personal data at any time by emailing <a href="mailto:support@spotd.biz">support@spotd.biz</a> or using the in-app account deletion feature.</p>
        <h3>Children's Privacy</h3>
        <p>Spotd is not intended for users under the age of 21. We do not knowingly collect information from anyone under 21.</p>
        <h3>Changes</h3>
        <p>We may update this policy from time to time. We will notify you of material changes via the app or email.</p>
        <h3>Contact</h3>
        <p>Questions? Email us at <a href="mailto:support@spotd.biz">support@spotd.biz</a></p>
      </div>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <h2 className={styles.title}>Terms of Service</h2>
      <p className={styles.effective}>Effective: March 2026</p>
      <div className={styles.legalBody}>
        <p>By using Spotd ("the App"), you agree to these Terms of Service. If you do not agree, do not use the App.</p>
        <h3>Eligibility</h3>
        <p>You must be at least 21 years of age to use Spotd. By creating an account, you confirm that you are 21 or older.</p>
        <h3>Account Responsibilities</h3>
        <p>You are responsible for maintaining the security of your account and for all activity under it. You agree to provide accurate information and keep it up to date.</p>
        <h3>Acceptable Use</h3>
        <p>You agree not to:</p>
        <ul>
          <li>Post false, misleading, or defamatory content</li>
          <li>Harass, bully, or threaten other users</li>
          <li>Upload illegal, obscene, or harmful content</li>
          <li>Spam or send unsolicited commercial messages</li>
          <li>Impersonate other users or entities</li>
          <li>Attempt to access other users' accounts</li>
          <li>Use the app for any unlawful purpose</li>
        </ul>
        <h3>User-Generated Content</h3>
        <p>You retain ownership of content you post (reviews, photos, comments). By posting, you grant Spotd a non-exclusive, worldwide license to display and distribute that content within the app. We may remove content that violates these terms.</p>
        <h3>Content Moderation</h3>
        <p>Users can report inappropriate content or users. We reserve the right to remove content and suspend or terminate accounts that violate these terms, at our sole discretion.</p>
        <h3>Venue Information</h3>
        <p>Happy hour times, deals, and event information are provided for convenience and may not always be current. Always verify directly with the venue.</p>
        <h3>Termination</h3>
        <p>You may delete your account at any time via Profile Settings. We may suspend or terminate accounts that violate these terms.</p>
        <h3>Disclaimer</h3>
        <p>Spotd is provided "as is" without warranties of any kind. We are not responsible for the accuracy of venue information or user-generated content.</p>
        <h3>Limitation of Liability</h3>
        <p>Spotd shall not be liable for any indirect, incidental, or consequential damages arising from your use of the app.</p>
        <h3>Contact</h3>
        <p>Questions? Email us at <a href="mailto:support@spotd.biz">support@spotd.biz</a></p>
      </div>
    </>
  );
}
