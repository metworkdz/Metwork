/**
 * Default text of the Startup Academy addendum ("Avenant Academy") a mentor
 * signs before submitting courses. The admin can replace it in Academy
 * settings. Tokens are those of the consultant contract (see
 * `server/consultant-contracts/variables.ts`), plus {{academy_share}} and
 * {{academy_metwork_share}}, filled from the mentor's Academy share when the
 * addendum is drafted (`server/academy/addendum.ts`).
 *
 * Draft wording written from the owner's decisions of 2026-10-26: to be
 * reviewed by Metwork's lawyer before it is sent to anyone.
 */
export const DEFAULT_ACADEMY_ADDENDUM = `Entre {{metwork_name}}, {{metwork_address}}, RC {{metwork_rc}}, NIF {{metwork_nif}}, au capital de {{metwork_capital}}, représentée par {{metwork_manager}}, ci-après « Metwork »,

et {{consultant_name}}, {{consultant_position}}, demeurant {{consultant_address}}, {{consultant_city}}, pièce d’identité n° {{consultant_id_number}}, ci-après « le Mentor »,

il est convenu le présent avenant au contrat de partenariat, relatif à la Startup Academy.

1. OBJET
Le présent avenant fixe les conditions dans lesquelles le Mentor crée et publie des cours vidéo sur la Startup Academy de Metwork (metwork.dz/academy), et la rémunération qu’il en reçoit.

2. CRÉATION ET VALIDATION DES COURS
Le Mentor crée ses cours depuis son espace Metwork. Aucun cours n’est publié sans la validation préalable de Metwork, qui peut demander des modifications ou refuser un cours. Une fois un cours publié, le Mentor peut y ajouter de nouveaux modules, qui ne sont visibles qu’après validation par Metwork. Toute autre modification d’un cours publié passe par Metwork.

3. LICENCE
Le Mentor concède à Metwork, pour la durée du présent avenant et pour le monde entier, le droit non exclusif de diffuser ses cours en streaming sur la Startup Academy, d’en faire la promotion et d’en extraire des passages à des fins de promotion. Le Mentor garantit être l’auteur de ses cours et détenir tous les droits nécessaires sur leur contenu.

4. PRIX
Le prix de vente d’un cours est fixé par le Mentor, sans pouvoir être inférieur à 2 900 DA. Metwork fixe librement le prix de l’Academy Pass et décide des cours qui y sont inclus.

5. RÉMUNÉRATION
5.1 Ventes de cours : le Mentor perçoit {{academy_share}} du prix public du cours, Metwork conservant {{academy_metwork_share}}. Les remises accordées par Metwork (membres Founder et Premium, codes promotionnels) sont à la charge de Metwork et ne réduisent pas la part du Mentor. Cette part est disponible au retrait sept (7) jours après la vente, une fois le délai de remboursement écoulé ; une vente remboursée dans ce délai n’ouvre droit à aucune rémunération.
5.2 Academy Pass : chaque mois d’abonnement d’un abonné est réparti entre les mentors qu’il a regardés, au prorata du temps de visionnage. Le Mentor perçoit {{academy_share}} du prix public mensuel du Pass multiplié par la part du temps de cet abonné passée sur ses cours. Cette part est disponible au retrait à la fin du mois concerné.
5.3 Les sommes sont créditées sur le portefeuille Metwork du Mentor et retirées selon les modalités du contrat de partenariat ({{payout_method}}).

6. PROTECTION DES CONTENUS
Les cours sont diffusés uniquement en streaming chiffré, avec un filigrane propre à chaque spectateur. Le Mentor s’engage à ne pas diffuser ailleurs, gratuitement ou contre paiement, le contenu de ses cours publiés sur la Startup Academy pendant la durée du présent avenant.

7. DURÉE ET FIN
Le présent avenant prend effet à sa signature, pour une durée indéterminée. Chaque partie peut y mettre fin moyennant un préavis de trente (30) jours. À sa fin, les cours du Mentor sont retirés du catalogue et de l’Academy Pass ; les personnes qui ont acheté un cours en conservent l’accès à vie, et le Mentor continue de percevoir sa part sur les ventes déjà réalisées.

8. DROIT APPLICABLE
Le présent avenant est régi par le droit algérien. Les autres dispositions du contrat de partenariat restent inchangées.

Fait le {{today}}.

{{signature_block}}`;
