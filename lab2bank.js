// BIOL 250 — Lab 2 Practical Question Bank
// Structure identification · tissue type · function — the three question styles Gabe gets on the
// Lab Practical II. Grounded in his OpenStax Lab 2 worksheets (Labs 12–23) + standard Martini 9e
// A&P. Format matches the ClaudeBank (options carry "A." letters; `correct` is a 0-based index).
// Feeds the Lab 2 "Structure & Tissue" drill + the Lab 2 mini-mocks (via activeClaudeBank("lab2")).
const LAB2_BANK = [
{
  title: "Lab 16 — The Heart",
  questions: [
    {q:"The thick middle layer of the heart wall, responsible for pumping, is the:", options:["A. Epicardium","B. Myocardium","C. Endocardium","D. Pericardium"], correct:1, tf:false, id:"L2-HRT-01"},
    {q:"What tissue type makes up the myocardium?", options:["A. Skeletal muscle","B. Smooth muscle","C. Cardiac muscle","D. Dense connective tissue"], correct:2, tf:false, id:"L2-HRT-02"},
    {q:"The inner lining of the heart chambers (endocardium) is composed of:", options:["A. Simple squamous epithelium (endothelium)","B. Stratified squamous epithelium","C. Simple columnar epithelium","D. Transitional epithelium"], correct:0, tf:false, id:"L2-HRT-03"},
    {q:"The visceral layer of the serous pericardium is also known as the:", options:["A. Fibrous pericardium","B. Parietal pericardium","C. Epicardium","D. Endocardium"], correct:2, tf:false, id:"L2-HRT-04"},
    {q:"The tough outer sac that anchors the heart in the mediastinum is the:", options:["A. Epicardium","B. Fibrous pericardium","C. Endocardium","D. Myocardium"], correct:1, tf:false, id:"L2-HRT-05"},
    {q:"The upper receiving chambers of the heart are the:", options:["A. Ventricles","B. Atria","C. Auricles","D. Ventricular septa"], correct:1, tf:false, id:"L2-HRT-06"},
    {q:"Which valve lies between the right atrium and right ventricle?", options:["A. Mitral (bicuspid) valve","B. Aortic semilunar valve","C. Tricuspid valve","D. Pulmonary semilunar valve"], correct:2, tf:false, id:"L2-HRT-07"},
    {q:"The valve between the left atrium and left ventricle is the:", options:["A. Tricuspid valve","B. Bicuspid (mitral) valve","C. Pulmonary valve","D. Aortic valve"], correct:1, tf:false, id:"L2-HRT-08"},
    {q:"The AV (cuspid) valves are anchored to papillary muscles by the:", options:["A. Trabeculae carneae","B. Chordae tendineae","C. Moderator band","D. Pectinate muscles"], correct:1, tf:false, id:"L2-HRT-09"},
    {q:"Oxygen-poor blood returns to the heart from the body and enters the:", options:["A. Left atrium","B. Right atrium","C. Left ventricle","D. Right ventricle"], correct:1, tf:false, id:"L2-HRT-10"},
    {q:"Oxygenated blood returns from the lungs via the pulmonary veins into the:", options:["A. Right atrium","B. Left atrium","C. Right ventricle","D. Aorta"], correct:1, tf:false, id:"L2-HRT-11"},
    {q:"The natural pacemaker of the heart is the:", options:["A. AV node","B. SA (sinoatrial) node","C. Bundle of His","D. Purkinje fibers"], correct:1, tf:false, id:"L2-HRT-12"},
    {q:"Cardiac muscle cells are joined electrically and mechanically by:", options:["A. Tight junctions","B. Desmosomes only","C. Intercalated discs","D. Basement membranes"], correct:2, tf:false, id:"L2-HRT-13"},
    {q:"The coronary arteries that supply the heart wall arise from the:", options:["A. Pulmonary trunk","B. Base of the aorta","C. Superior vena cava","D. Coronary sinus"], correct:1, tf:false, id:"L2-HRT-14"},
  ]
},
{
  title: "Lab 17 — Blood Vessels & Circulation",
  questions: [
    {q:"The three tunics (layers) of a typical blood-vessel wall are the tunica intima, tunica media, and tunica:", options:["A. Externa (adventitia)","B. Mucosa","C. Serosa","D. Submucosa"], correct:0, tf:false, id:"L2-VES-01"},
    {q:"The innermost tunic (tunica intima) is lined by:", options:["A. Simple squamous epithelium (endothelium)","B. Smooth muscle","C. Dense connective tissue","D. Transitional epithelium"], correct:0, tf:false, id:"L2-VES-02"},
    {q:"The tunica media is composed mainly of:", options:["A. Endothelium","B. Smooth muscle and elastic fibers","C. Cardiac muscle","D. Simple columnar epithelium"], correct:1, tf:false, id:"L2-VES-03"},
    {q:"The tunica externa (adventitia) is composed mostly of:", options:["A. Smooth muscle","B. Endothelium","C. Connective tissue (collagen)","D. Skeletal muscle"], correct:2, tf:false, id:"L2-VES-04"},
    {q:"Compared with veins, arteries generally have:", options:["A. Thinner walls and valves","B. A thicker tunica media and rounder lumen","C. A larger lumen and thinner walls","D. No smooth muscle"], correct:1, tf:false, id:"L2-VES-05"},
    {q:"A capillary wall consists of:", options:["A. Three thick tunics","B. A single layer of endothelium plus a basement membrane","C. Smooth muscle and elastic laminae","D. Stratified squamous epithelium"], correct:1, tf:false, id:"L2-VES-06"},
    {q:"Valves that prevent the backflow of blood are found in:", options:["A. Elastic arteries","B. Arterioles","C. Veins","D. Capillaries"], correct:2, tf:false, id:"L2-VES-07"},
    {q:"Exchange of gases and nutrients between blood and tissue occurs at the:", options:["A. Arteries","B. Arterioles","C. Capillaries","D. Veins"], correct:2, tf:false, id:"L2-VES-08"},
    {q:"The largest elastic (conducting) artery in the body is the:", options:["A. Aorta","B. Pulmonary trunk","C. Femoral artery","D. Carotid artery"], correct:0, tf:false, id:"L2-VES-09"},
    {q:"The correct order of blood flow from the heart is:", options:["A. Artery → vein → capillary → arteriole → venule","B. Artery → arteriole → capillary → venule → vein","C. Vein → venule → capillary → arteriole → artery","D. Capillary → artery → arteriole → venule → vein"], correct:1, tf:false, id:"L2-VES-10"},
    {q:"Which vessels have the thinnest walls relative to their lumen?", options:["A. Elastic arteries","B. Muscular arteries","C. Veins","D. Arterioles"], correct:2, tf:false, id:"L2-VES-11"},
  ]
},
{
  title: "Lab 19 — The Respiratory System",
  questions: [
    {q:"Most of the conducting airways (trachea and bronchi) are lined by:", options:["A. Simple squamous epithelium","B. Pseudostratified ciliated columnar epithelium","C. Stratified squamous epithelium","D. Transitional epithelium"], correct:1, tf:false, id:"L2-RES-01"},
    {q:"The C-shaped rings that keep the trachea open are made of:", options:["A. Elastic cartilage","B. Fibrocartilage","C. Hyaline cartilage","D. Bone"], correct:2, tf:false, id:"L2-RES-02"},
    {q:"Gas exchange in the lungs occurs across the:", options:["A. Bronchioles","B. Alveoli","C. Trachea","D. Pleura"], correct:1, tf:false, id:"L2-RES-03"},
    {q:"The alveolar wall (type I pneumocytes) is composed of:", options:["A. Simple squamous epithelium","B. Simple columnar epithelium","C. Pseudostratified epithelium","D. Cardiac muscle"], correct:0, tf:false, id:"L2-RES-04"},
    {q:"Surfactant, which reduces surface tension in the alveoli, is secreted by:", options:["A. Type I alveolar cells","B. Type II alveolar cells","C. Goblet cells","D. Alveolar macrophages"], correct:1, tf:false, id:"L2-RES-05"},
    {q:"The flap of elastic cartilage that covers the laryngeal opening during swallowing is the:", options:["A. Epiglottis","B. Thyroid cartilage","C. Uvula","D. Glottis"], correct:0, tf:false, id:"L2-RES-06"},
    {q:"The 'voice box,' which houses the vocal cords, is the:", options:["A. Pharynx","B. Larynx","C. Trachea","D. Bronchus"], correct:1, tf:false, id:"L2-RES-07"},
    {q:"How many lobes does the right lung have?", options:["A. One","B. Two","C. Three","D. Four"], correct:2, tf:false, id:"L2-RES-08"},
    {q:"The serous membrane that directly covers the surface of the lung is the:", options:["A. Parietal pleura","B. Visceral pleura","C. Pericardium","D. Peritoneum"], correct:1, tf:false, id:"L2-RES-09"},
    {q:"The trachea divides into the right and left main bronchi at a ridge called the:", options:["A. Hilum","B. Carina","C. Glottis","D. Larynx"], correct:1, tf:false, id:"L2-RES-10"},
    {q:"The terminal air sacs where gas exchange occurs are the:", options:["A. Bronchioles","B. Alveoli","C. Alveolar ducts","D. Pleural cavities"], correct:1, tf:false, id:"L2-RES-11"},
  ]
},
{
  title: "Lab 20 — The Digestive System",
  questions: [
    {q:"From the lumen outward, the four layers (tunics) of the GI tract are mucosa, submucosa, muscularis externa, and:", options:["A. Serosa (adventitia)","B. Endothelium","C. Tunica media","D. Epicardium"], correct:0, tf:false, id:"L2-DIG-01"},
    {q:"The esophagus is lined by which epithelium (protects against abrasion)?", options:["A. Simple columnar","B. Stratified squamous","C. Pseudostratified columnar","D. Transitional"], correct:1, tf:false, id:"L2-DIG-02"},
    {q:"The stomach and small intestine are lined by:", options:["A. Simple columnar epithelium","B. Stratified squamous epithelium","C. Transitional epithelium","D. Simple squamous epithelium"], correct:0, tf:false, id:"L2-DIG-03"},
    {q:"Which accessory organ produces bile?", options:["A. Gallbladder","B. Pancreas","C. Liver","D. Spleen"], correct:2, tf:false, id:"L2-DIG-04"},
    {q:"Bile is stored and concentrated in the:", options:["A. Liver","B. Gallbladder","C. Duodenum","D. Pancreas"], correct:1, tf:false, id:"L2-DIG-05"},
    {q:"The pancreas is described as both an endocrine gland and a(n):", options:["A. Lymphatic organ","B. Exocrine gland","C. Muscular organ","D. Reproductive organ"], correct:1, tf:false, id:"L2-DIG-06"},
    {q:"Fingerlike projections of the small-intestine mucosa that increase surface area are the:", options:["A. Rugae","B. Villi","C. Haustra","D. Plicae only"], correct:1, tf:false, id:"L2-DIG-07"},
    {q:"The first (and shortest) segment of the small intestine is the:", options:["A. Jejunum","B. Ileum","C. Duodenum","D. Cecum"], correct:2, tf:false, id:"L2-DIG-08"},
    {q:"The correct proximal-to-distal order of the small intestine is:", options:["A. Ileum, jejunum, duodenum","B. Duodenum, jejunum, ileum","C. Jejunum, duodenum, ileum","D. Duodenum, ileum, jejunum"], correct:1, tf:false, id:"L2-DIG-09"},
    {q:"The largest gland (and largest internal organ) in the body is the:", options:["A. Pancreas","B. Spleen","C. Liver","D. Stomach"], correct:2, tf:false, id:"L2-DIG-10"},
    {q:"Peristalsis (movement of food) is produced by the smooth muscle of the:", options:["A. Mucosa","B. Submucosa","C. Muscularis externa","D. Serosa"], correct:2, tf:false, id:"L2-DIG-11"},
    {q:"The muscular sac that mixes food with gastric juice is the:", options:["A. Esophagus","B. Stomach","C. Cecum","D. Colon"], correct:1, tf:false, id:"L2-DIG-12"},
  ]
},
{
  title: "Lab 21 — The Urinary System",
  questions: [
    {q:"The functional (filtering) unit of the kidney is the:", options:["A. Nephron","B. Renal pyramid","C. Calyx","D. Ureter"], correct:0, tf:false, id:"L2-URI-01"},
    {q:"Filtration of blood begins at a tuft of capillaries called the:", options:["A. Loop of Henle","B. Glomerulus","C. Collecting duct","D. Renal pelvis"], correct:1, tf:false, id:"L2-URI-02"},
    {q:"The ureters and urinary bladder are lined by which stretchable epithelium?", options:["A. Simple squamous","B. Stratified squamous","C. Transitional epithelium (urothelium)","D. Pseudostratified columnar"], correct:2, tf:false, id:"L2-URI-03"},
    {q:"The muscular organ that stores urine is the:", options:["A. Kidney","B. Ureter","C. Urinary bladder","D. Urethra"], correct:2, tf:false, id:"L2-URI-04"},
    {q:"Urine is carried from the kidney to the bladder by the:", options:["A. Urethra","B. Ureter","C. Renal artery","D. Collecting duct"], correct:1, tf:false, id:"L2-URI-05"},
    {q:"Urine is carried from the bladder to the outside of the body by the:", options:["A. Ureter","B. Urethra","C. Renal pelvis","D. Nephron"], correct:1, tf:false, id:"L2-URI-06"},
    {q:"The outer region of the kidney, containing the renal corpuscles, is the:", options:["A. Renal medulla","B. Renal cortex","C. Renal pelvis","D. Hilum"], correct:1, tf:false, id:"L2-URI-07"},
    {q:"The cone-shaped structures in the renal medulla are the:", options:["A. Renal columns","B. Renal pyramids","C. Major calyces","D. Glomeruli"], correct:1, tf:false, id:"L2-URI-08"},
    {q:"Urine flows from a papilla into a minor calyx, then a major calyx, then the:", options:["A. Ureter","B. Renal pelvis","C. Urethra","D. Bladder"], correct:1, tf:false, id:"L2-URI-09"},
    {q:"Which urethra is significantly longer?", options:["A. Female","B. Male","C. They are the same length","D. Neither has a urethra"], correct:1, tf:false, id:"L2-URI-10"},
  ]
},
{
  title: "Lab 14 — The Endocrine System",
  questions: [
    {q:"The 'master gland,' controlled by the hypothalamus, is the:", options:["A. Thyroid gland","B. Pituitary gland","C. Adrenal gland","D. Pineal gland"], correct:1, tf:false, id:"L2-END-01"},
    {q:"Endocrine glands are described as 'ductless' because they secrete hormones directly into the:", options:["A. Digestive tract","B. Blood/interstitial fluid","C. Ducts","D. Lymphatic vessels only"], correct:1, tf:false, id:"L2-END-02"},
    {q:"The butterfly-shaped gland in the anterior neck is the:", options:["A. Parathyroid","B. Thymus","C. Thyroid","D. Pituitary"], correct:2, tf:false, id:"L2-END-03"},
    {q:"The glands that sit on the superior pole of each kidney are the:", options:["A. Adrenal (suprarenal) glands","B. Parathyroid glands","C. Gonads","D. Pineal glands"], correct:0, tf:false, id:"L2-END-04"},
    {q:"Which organ is both an endocrine and an exocrine gland?", options:["A. Thyroid","B. Pituitary","C. Pancreas","D. Adrenal"], correct:2, tf:false, id:"L2-END-05"},
    {q:"The endocrine cells of the pancreas that secrete insulin and glucagon are the:", options:["A. Acini","B. Pancreatic islets (of Langerhans)","C. Chief cells","D. Follicular cells"], correct:1, tf:false, id:"L2-END-06"},
    {q:"The pineal gland secretes which hormone that regulates the sleep–wake cycle?", options:["A. Insulin","B. Thyroxine","C. Melatonin","D. Cortisol"], correct:2, tf:false, id:"L2-END-07"},
    {q:"The adrenal medulla (inner region) secretes:", options:["A. Steroid hormones","B. Epinephrine and norepinephrine","C. Thyroid hormone","D. Melatonin"], correct:1, tf:false, id:"L2-END-08"},
  ]
},
{
  title: "Lab 15 — Blood",
  questions: [
    {q:"The straw-colored fluid portion of blood is:", options:["A. Serum only","B. Plasma","C. Lymph","D. Hemoglobin"], correct:1, tf:false, id:"L2-BLD-01"},
    {q:"The most numerous formed elements in blood are the:", options:["A. Leukocytes","B. Platelets","C. Erythrocytes (RBCs)","D. Monocytes"], correct:2, tf:false, id:"L2-BLD-02"},
    {q:"The formed elements that defend against infection are the:", options:["A. Erythrocytes","B. Leukocytes (WBCs)","C. Platelets","D. Plasma proteins"], correct:1, tf:false, id:"L2-BLD-03"},
    {q:"Cell fragments essential for blood clotting are the:", options:["A. Erythrocytes","B. Lymphocytes","C. Platelets (thrombocytes)","D. Neutrophils"], correct:2, tf:false, id:"L2-BLD-04"},
    {q:"Plasma makes up approximately what percentage of whole blood?", options:["A. About 10%","B. About 25%","C. About 55%","D. About 90%"], correct:2, tf:false, id:"L2-BLD-05"},
    {q:"A hematocrit measures the percentage of blood volume occupied by:", options:["A. Plasma","B. White blood cells","C. Packed red blood cells","D. Platelets"], correct:2, tf:false, id:"L2-BLD-06"},
    {q:"Red blood cells transport oxygen bound to:", options:["A. Albumin","B. Hemoglobin","C. Fibrinogen","D. Globulin"], correct:1, tf:false, id:"L2-BLD-07"},
    {q:"The most abundant type of white blood cell is the:", options:["A. Lymphocyte","B. Monocyte","C. Neutrophil","D. Basophil"], correct:2, tf:false, id:"L2-BLD-08"},
  ]
},
{
  title: "Lab 18 — The Lymphatic System",
  questions: [
    {q:"The largest lymphatic organ in the body is the:", options:["A. Thymus","B. Spleen","C. Tonsil","D. Lymph node"], correct:1, tf:false, id:"L2-LYM-01"},
    {q:"Small bean-shaped organs that filter lymph and house lymphocytes are the:", options:["A. Lymph nodes","B. Spleen","C. Thymus","D. Peyer's patches"], correct:0, tf:false, id:"L2-LYM-02"},
    {q:"The primary lymphatic organs (where lymphocytes form/mature) are the:", options:["A. Spleen and tonsils","B. Red bone marrow and thymus","C. Lymph nodes and spleen","D. Tonsils and appendix"], correct:1, tf:false, id:"L2-LYM-03"},
    {q:"The gland in the superior mediastinum where T-lymphocytes mature is the:", options:["A. Thyroid","B. Spleen","C. Thymus","D. Pineal gland"], correct:2, tf:false, id:"L2-LYM-04"},
    {q:"Lymphatic capillaries differ from blood capillaries in that they are:", options:["A. Lined by smooth muscle","B. Closed at one end (blind-ended)","C. Made of cartilage","D. Part of the arterial system"], correct:1, tf:false, id:"L2-LYM-05"},
    {q:"Most of the body's lymph is returned to the bloodstream through the:", options:["A. Right lymphatic duct","B. Thoracic duct","C. Renal vein","D. Pulmonary vein"], correct:1, tf:false, id:"L2-LYM-06"},
    {q:"The masses of lymphatic tissue guarding the entrance to the pharynx are the:", options:["A. Tonsils","B. Peyer's patches","C. Adrenal glands","D. Thymic lobules"], correct:0, tf:false, id:"L2-LYM-07"},
  ]
},
{
  title: "Lab 12 — Spinal Cord & Spinal Nerves",
  questions: [
    {q:"The deep groove on the anterior midline of the spinal cord is the:", options:["A. Posterior median sulcus","B. Anterior median fissure","C. Central canal","D. Dorsal root"], correct:1, tf:false, id:"L2-SPN-01"},
    {q:"In cross-section, the gray matter of the spinal cord is shaped like a:", options:["A. Circle","B. Butterfly (or H)","C. Triangle","D. Star"], correct:1, tf:false, id:"L2-SPN-02"},
    {q:"Sensory (afferent) axons enter the spinal cord through the:", options:["A. Anterior (ventral) root","B. Posterior (dorsal) root","C. Central canal","D. Gray commissure"], correct:1, tf:false, id:"L2-SPN-03"},
    {q:"Motor (efferent) axons leave the spinal cord through the:", options:["A. Posterior (dorsal) root","B. Anterior (ventral) root","C. Dorsal root ganglion","D. Posterior median sulcus"], correct:1, tf:false, id:"L2-SPN-04"},
    {q:"How many pairs of spinal nerves are there?", options:["A. 12","B. 24","C. 31","D. 43"], correct:2, tf:false, id:"L2-SPN-05"},
    {q:"The tapered inferior end of the spinal cord (~L1–L2) is the:", options:["A. Cauda equina","B. Conus medullaris","C. Filum terminale","D. Cervical enlargement"], correct:1, tf:false, id:"L2-SPN-06"},
    {q:"The collection of nerve roots extending below the conus medullaris is the:", options:["A. Cauda equina","B. Brachial plexus","C. Filum terminale","D. Dorsal root ganglion"], correct:0, tf:false, id:"L2-SPN-07"},
    {q:"There are how many pairs of cranial nerves?", options:["A. 10","B. 12","C. 24","D. 31"], correct:1, tf:false, id:"L2-SPN-08"},
  ]
},
{
  title: "Lab 13 — Special Senses (Eye, Ear, Taste, Smell)",
  questions: [
    {q:"The surface of the tongue is lined by which epithelium?", options:["A. Simple columnar","B. Stratified squamous","C. Transitional","D. Pseudostratified columnar"], correct:1, tf:false, id:"L2-SEN-01"},
    {q:"Taste receptor cells are housed within structures called:", options:["A. Papillae only","B. Taste buds","C. Olfactory bulbs","D. Rods"], correct:1, tf:false, id:"L2-SEN-02"},
    {q:"The photoreceptors of the eye (rods and cones) are located in the:", options:["A. Cornea","B. Lens","C. Retina","D. Sclera"], correct:2, tf:false, id:"L2-SEN-03"},
    {q:"The transparent anterior structure that first refracts light entering the eye is the:", options:["A. Lens","B. Cornea","C. Iris","D. Pupil"], correct:1, tf:false, id:"L2-SEN-04"},
    {q:"The colored, muscular structure that controls the size of the pupil is the:", options:["A. Sclera","B. Retina","C. Iris","D. Choroid"], correct:2, tf:false, id:"L2-SEN-05"},
    {q:"The structure that changes shape to fine-focus light on the retina is the:", options:["A. Cornea","B. Lens","C. Iris","D. Vitreous body"], correct:1, tf:false, id:"L2-SEN-06"},
    {q:"The tough white outer layer (the 'white') of the eye is the:", options:["A. Choroid","B. Sclera","C. Retina","D. Conjunctiva"], correct:1, tf:false, id:"L2-SEN-07"},
    {q:"The snail-shaped organ of hearing in the inner ear is the:", options:["A. Cochlea","B. Semicircular canals","C. Vestibule","D. Tympanic membrane"], correct:0, tf:false, id:"L2-SEN-08"},
    {q:"The structures responsible for detecting rotational movement (balance) are the:", options:["A. Cochlea","B. Semicircular canals","C. Ossicles","D. Eustachian tube"], correct:1, tf:false, id:"L2-SEN-09"},
    {q:"The 'eardrum,' which vibrates in response to sound, is the:", options:["A. Oval window","B. Tympanic membrane","C. Cochlea","D. Pinna"], correct:1, tf:false, id:"L2-SEN-10"},
  ]
},
{
  title: "Lab 22 — Male Reproductive System",
  questions: [
    {q:"Sperm are produced (spermatogenesis) within the:", options:["A. Epididymis","B. Seminiferous tubules of the testes","C. Prostate gland","D. Ductus deferens"], correct:1, tf:false, id:"L2-MRE-01"},
    {q:"Sperm mature and are stored in the:", options:["A. Seminal vesicle","B. Epididymis","C. Prostate","D. Urethra"], correct:1, tf:false, id:"L2-MRE-02"},
    {q:"The duct that carries sperm from the epididymis toward the urethra is the:", options:["A. Ureter","B. Ductus (vas) deferens","C. Ejaculatory duct only","D. Efferent ductule"], correct:1, tf:false, id:"L2-MRE-03"},
    {q:"The gland that encircles the urethra just inferior to the bladder is the:", options:["A. Seminal vesicle","B. Bulbourethral gland","C. Prostate gland","D. Testis"], correct:2, tf:false, id:"L2-MRE-04"},
    {q:"The paired glands posterior to the bladder that contribute most of the semen volume are the:", options:["A. Bulbourethral glands","B. Seminal vesicles","C. Prostate glands","D. Epididymides"], correct:1, tf:false, id:"L2-MRE-05"},
    {q:"The interstitial (Leydig) cells of the testis produce:", options:["A. Sperm","B. Testosterone","C. Inhibin","D. Semen"], correct:1, tf:false, id:"L2-MRE-06"},
    {q:"The skin-covered sac that houses and thermoregulates the testes is the:", options:["A. Spermatic cord","B. Scrotum","C. Tunica albuginea","D. Prepuce"], correct:1, tf:false, id:"L2-MRE-07"},
  ]
},
{
  title: "Lab 23 — Female Reproductive System",
  questions: [
    {q:"The female gonad, which produces oocytes and hormones, is the:", options:["A. Uterus","B. Ovary","C. Uterine tube","D. Cervix"], correct:1, tf:false, id:"L2-FRE-01"},
    {q:"Fertilization normally occurs in the:", options:["A. Uterus","B. Uterine (fallopian) tube","C. Cervix","D. Vagina"], correct:1, tf:false, id:"L2-FRE-02"},
    {q:"The hollow, muscular organ where a fetus develops is the:", options:["A. Ovary","B. Uterus","C. Vagina","D. Uterine tube"], correct:1, tf:false, id:"L2-FRE-03"},
    {q:"The inner lining of the uterus, which thickens and sheds during the cycle, is the:", options:["A. Myometrium","B. Endometrium","C. Perimetrium","D. Serosa"], correct:1, tf:false, id:"L2-FRE-04"},
    {q:"The thick muscular wall of the uterus that contracts during labor is the:", options:["A. Endometrium","B. Myometrium","C. Perimetrium","D. Cervix"], correct:1, tf:false, id:"L2-FRE-05"},
    {q:"The narrow inferior neck of the uterus that opens into the vagina is the:", options:["A. Fundus","B. Body","C. Cervix","D. Isthmus"], correct:2, tf:false, id:"L2-FRE-06"},
    {q:"The finger-like projections at the end of the uterine tube that sweep the oocyte inward are the:", options:["A. Fimbriae","B. Villi","C. Rugae","D. Cilia only"], correct:0, tf:false, id:"L2-FRE-07"},
  ]
},
];
if (typeof module !== "undefined" && module.exports) module.exports = LAB2_BANK;
