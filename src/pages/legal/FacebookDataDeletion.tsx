import { LegalPage } from "@/components/legal/LegalPage";

const FacebookDataDeletion = () => (
  <LegalPage
    title="Facebook Data Deletion Instructions"
    slug="facebook-data-deletion"
    description="How to request deletion of data associated with your Facebook login on Purely Health Nutra."
  >
    <p>
      If you used Facebook to sign in or interacted with our Facebook-connected features, you may request
      deletion of the data we hold about you.
    </p>

    <h2>Option 1 — Remove the app on Facebook</h2>
    <ul>
      <li>Go to Facebook <em>Settings &amp; Privacy → Settings</em>.</li>
      <li>Open <em>Apps and Websites</em>.</li>
      <li>Find Purely Health Nutra and choose <em>Remove</em>.</li>
      <li>Select the option to delete the data associated with the app.</li>
    </ul>

    <h2>Option 2 — Email us directly</h2>
    <p>
      Send a deletion request to admin@proagrisa.co.za with the subject "Facebook Data Deletion" and
      include the email address or Facebook name linked to your account.
    </p>

    <h2>What happens next</h2>
    <ul>
      <li>We confirm your request within 5 business days.</li>
      <li>We delete or anonymise the associated data within 30 days.</li>
      <li>Records we must keep by law (for example, tax and order records) are retained.</li>
    </ul>
  </LegalPage>
);

export default FacebookDataDeletion;
