// imports
const fastify = require("fastify")({logger: true});
const fs = require('fs');
const path = require('path');

// Initialize DataBase
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./src/data/database.sqlite');

//helper functions
function clearTable() {
  db.run(`DELETE FROM Participants`, (err) => {
    if (err) {
      console.error(err.message);
    } else {
      console.log(`Participants cleared successfully!`);
    }
  });
}

/* YES There are a LOT of fields ! These fields are not really necessary as they can already be accessed via the Qualtrics results, but I still wanted to have them in the DB for simplicity
The main fields that you will find in the DB that wouldn't be in Qualtrics would be the theory_score, practical_score and category. "training_done" boolean is used for
the background task, to know whether a user has passed a training or not (used for timing purpose) */
function initDb() {
  db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS Participants (prolific_id TEXT, session_id TEXT, study_id TEXT, category INTEGER, theory_score FLOAT, practical_score FLOAT, training_exp TEXT,self_report TEXT,frequency_mail TEXT,quantity_mail TEXT, age_group TEXT,education_level TEXT,it_background TEXT,occupation TEXT, new_theory_score FLOAT, new_practical_score FLOAT, new_category INTEGER, training_done INTEGER)');
  }); 
}

function displayParticipants() {
  db.serialize(() => {
    db.all('SELECT * FROM Participants;', [], (err, rows) => {
      if (err) {
        console.error(err.message);
      } else {
        console.log('Participants:');
        rows.forEach((row) => {
          console.log(row);
        });
      }
    });
  });
}

function addParticipant(prolific_id,session_id,study_id,category,theory_score,practical_score,training_exp,self_report,frequency_mail,quantity_mail,age_group,education_level,it_background,occupation,new_theory_score,new_practical_score,new_category,training_done) {
  db.serialize(() => {
    db.run(
    'INSERT OR REPLACE INTO Participants (prolific_id,session_id,study_id,category,theory_score,practical_score,training_exp,self_report,frequency_mail,quantity_mail,age_group,education_level,it_background,occupation,new_theory_score,new_practical_score,new_category,training_done) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [prolific_id,session_id,study_id,category,theory_score,practical_score,training_exp,self_report,frequency_mail,quantity_mail,age_group,education_level,it_background,occupation,new_theory_score,new_practical_score,new_category,training_done],
    (err) => {
      if (err) {
        return console.error(err.message);
      }
      console.log('Data inserted or updated successfully!');
    }
  ); });
}
function updateParticipant(prolific_id, field, value) {
  const sql = `UPDATE Participants 
              SET ${field} = ?
              WHERE prolific_id = ?`;

  db.run(sql, [value, prolific_id], function (err) {
    if (err) {
      console.error(err.message);
    } else {
      console.log(`Row with id ${prolific_id} updated successfully!`);
    }
  });
}

function getElementByProlificId(prolific_id) {
  return new Promise((resolve, reject) => {
    try {
      db.get('SELECT * FROM Participants WHERE prolific_id = ?', [prolific_id], (err, row) => {
        if (err) {
          console.error(err.message);
          reject(err);
        } else {
          if (row) {
            resolve(row);
          } else {
            console.log('No participant found with this id');
            resolve(null); // Resolve with null when no participant found
          }
        }
      });
    } catch (error) {
      console.log("rejecting error");
      console.error(error.message);
      reject(error);
    }
  });
}


function computePracticalScore(answ,resp) {
  return answ == resp ? 2 : 0;
}

function classifyUseFrequencyCategory(frequency_mail) {
  return (frequency_mail == "less than once a week" || frequency_mail == "approximately once a week") ? 0: 1;
}

function classifyMailQuantityCategory(quantity_mail) {
  return (quantity_mail == "Less than 5") ? 0: 1;
}  

function getPointsFromSelfReport(self_report) {
  if (typeof self_report !== 'string') {
    // Handle the case where self_report is not a string
    console.log("Not a string");
    return 0; 
  }
  const arr = self_report.split(', ');
  var score = 0;
  for (let i = 0; i < 3; i++) {
    if (arr[i] == "very high") {
      score += 1;
    } else if (arr[i] == "rather high") {
      score += 0.5;
    } else if (arr[i] == "medium") {
      score += 0.25;
    }
  }
  return score;
}

function determineCategory(theory_score,practical_score,training_exp,self_report,frequency_mail,quantity_mail) {
  let category;
    // Determine the user category based on the score. Theory score inferior to 13 means low knowledge. 
  if (theory_score < 20.5) {
    // theory questions will determine if a user has basic knowledge. In total, the user can get 39.5 points. If he has less than 1/3 correct, then he needs education.
    category = 0;
  } else {
      // compute the total score with both the theory score and practical score (total possible score is now 49.5)
      var score = theory_score + practical_score;
        //We add a bonus if the user had previous training exp
        if (training_exp == "Yes, once") {
          score += 1; // small bonus because we don't know the nature of the training: how well-designed and efficient it was. The user also might have forgotten what he previously learned.
        } else if (training_exp = "Yes, more than once") {
          score += 2;
        }
        // bonus from self report
        score += getPointsFromSelfReport(self_report);
        // If the user has less than half of the points, he is immediately sorted as needing training
        if (score < 27.5) {
          category = 0;
        } else {
          if (score >= 39.5) {
            // In this situation, the user is considered to have sufficient knowledge to be sorted as "high knowledge", only needing reminders
            category = 2;
          } else {
            // In the case where the user is in-between (not obviously needing training, not obviously high knowledge), we use other parameters
            if (frequency_mail == 0) {
              // If the user uses rarely the mailbox, then...
              if (quantity_mail == 0) {
                // In the other cases, he is at low risk and only needs reminders (he will statistically be less exposed to phishing)
                category = 2;
              } else {
                // ... if he receives a lot or a good amount of mail, he is at risk and needs training. 
                category = 1;
              }
            } else {
               // If the user uses the mailbox a lot, he is at risk and needs training
               category = 1;
            }

        }     
    }     
 } 
 return category;
}

/* Admin functions
fastify.get("/deleteDB", function (request, reply) {
  deleteTable();
})

fastify.get("/initDB", function (request, reply) {
  initDb();
})

fastify.get("/displayDB", function (request, reply) {
  displayParticipants()
})

fastify.get("/clearDB", function (request, reply) {
  clearTable();
})
*/


// routes
// default index page
fastify.get("/", function (request, reply) {
  const url = "https://descil.eu.qualtrics.com/jfe/form/SV_1Ny7AsXpCffLqlM?PROLIFIC_PID=default&SESSION_ID=default&STUDY_ID=default";
  reply.redirect(url);
});

// Receives score and determines category after pre-intervention form
fastify.post("/score", async function (request, reply) {
  console.log("setting score");
  // The theory score is on 39.5
  const theory_score = parseInt(request.body.score);
  const frequency_mail = classifyUseFrequencyCategory(request.body.frequency_mail);
  const quantity_mail = classifyMailQuantityCategory(request.body.quantity_mail); 
  var training_exp = request.body.training_exp;
  const self_report = request.body.self_report;
  const prolific_id = request.body.prolific_id;
  const session_id = request.body.session_id;
  const study_id = request.body.study_id;
  const practical_score = computePracticalScore(request.body.classify_q1,"Yes") + computePracticalScore(request.body.classify_q2,"Yes") + computePracticalScore(request.body.classify_q3,"Yes") + computePracticalScore(request.body.classify_q4,"No") + computePracticalScore(request.body.classify_q5,"Yes")
  const category = determineCategory(theory_score,practical_score,training_exp,self_report,frequency_mail,quantity_mail)
  // add this user to DB
  addParticipant(prolific_id,session_id,study_id,category,theory_score,practical_score,training_exp,self_report,request.body.frequency_mail,request.body.quantity_mail,null,null,null,null,null,null,null,0)
  console.log("The category of the user is ",category);
});

// base page in case of an invalid participant
fastify.get("/base_page", async function (request, reply) {
    const html = `  
      <!DOCTYPE html>
      <html>
      <head></head>
      <body>You should be a valid participant in order to access this study.</body>
      </html>
      `;
    reply.type('text/html').send(html);
});

// post page when participant is done with training, sets the boolean notifying that the training is done
fastify.post("/end_training", async function (request, reply) {
  console.log("end training for:");
  const prolific_id = request.body.prolific_id;
  updateParticipant(prolific_id, "training_done", 1);
});

// post page when participant is done with post-intervention form, updates the missing fields
fastify.post("/end_study", async function (request, reply) {
  console.log("end study");
  const prolific_id = request.body.prolific_id;
  let row;
  try {
    const theory_score = parseInt(request.body.score);
    const practical_score = computePracticalScore(request.body.classify_q1,"Yes") + computePracticalScore(request.body.classify_q2,"Yes") + computePracticalScore(request.body.classify_q3,"Yes") + computePracticalScore(request.body.classify_q4,"No") + computePracticalScore(request.body.classify_q5,"Yes")
    const row_ = await getElementByProlificId(prolific_id);
    let category;
    if (row_) {
      category = determineCategory(theory_score,practical_score,row_.training_exp,row_.self_report,row_.frequency_mail,row_.quantity_mail);       
    } else {
      category = determineCategory(theory_score,practical_score,"","","","");
    }
    updateParticipant(prolific_id, "new_theory_score", theory_score);
    updateParticipant(prolific_id, "new_practical_score", practical_score);
    updateParticipant(prolific_id, "new_category", category); 
    
  } catch (error) {
    console.error(error);
  }
  updateParticipant(prolific_id, "it_background", request.body.it_background);
  updateParticipant(prolific_id, "occupation", request.body.occupation);
  updateParticipant(prolific_id, "age_group", request.body.age_group);
  updateParticipant(prolific_id, "education_level", request.body.education_level);
});

// Get background task
fastify.get('/bgtask', async (request, reply) => {
  const prolific_id = request.query.prolific_id;
  console.log(prolific_id);
  // in case a user would try to access the background task without following the intended flow
  if (prolific_id == null) {
    reply.redirect("https://personalized-anti-phishing-web-app.glitch.me/base_page");
  }
  let category;
  let training_done;
  const row = await getElementByProlificId(prolific_id);
  if (row) {
      category = row.category;
      training_done = row.training_done;
  } else {
      console.log("did not manage to find participant");
      category = Math.floor(Math.random() * 3);
      console.log(category);
      training_done = 0;
      addParticipant(prolific_id,null,null,category,null,null,"","","","",null,null,null,null,null,null,null,0)
  }
  // This is the integrated figma. Could be stored in a seperate HTML file, but might miss the JS variables, TODO for modularization
  const html = `  
    <!DOCTYPE html>
    <html>
    <head>
    </head>
    <body> 
      <iframe id="figmaFrame" style="border: 1px solid rgba(0, 0, 0, 0.1); position: absolute; display: block;" width="100%" height="100%" allowfullscreen></iframe>
      <div id="popup-overlay" style="display:none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); z-index: 999;"></div>
      <div id="figma-overlay-top" style="display:block; position: absolute; top: 0; width: 100%; height: 10%; background-color: rgba(255, 255, 255, 0); z-index: 999;"></div>
      <div id="figma-overlay-bottom" style="display:block; position: absolute; bottom: 0; width: 100%; height: 5%; background-color: rgba(255, 255, 255, 0); z-index: 999;"></div>
      <div id="KnowledgePopUp" style="display:none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: #ffffff; border: 2px solid #ff0000; padding: 20px; z-index: 9999; text-align: center; box-shadow: 0px 0px 10px 2px rgba(0,0,0,0.5);">  
        <h2>Important Message</h2>
        <p>Wait! Some of your emails might be trying to scam you! Don't go any further without watching this video first!</p>
        <iframe id="youtubeFrame" width="560" height="315" src="https://www.youtube.com/embed/WG8V1_Sj5g0" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
        <button id="popupBtn" onclick="hideKnowledgePopUp()" style="display:none; background-color: #ff0000; color: #ffffff; border: none; padding: 10px 20px; border-radius: 5px; font-size: 18px; cursor: pointer;">Go back to my mails</button>
      </div> 
      <div id="TrainingPopUp" style="display:none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: #ffffff; border: 2px solid #ff0000; padding: 20px; z-index: 9999; text-align: center; box-shadow: 0px 0px 10px 2px rgba(0,0,0,0.5);">
        <h2>In order to continue using your mailbox safely, you should first complete this training module. This is meant to train your ability in detecting phishing mails.</h2>
        <p>Click the button below to access the training module.</p>
        <button onclick="location.href='https://descil.eu.qualtrics.com/jfe/form/SV_8DiG1QTe7VyxMbA?PROLIFIC_PID=${prolific_id}';" style="background-color: #ff0000; color: #ffffff; border: none; padding: 10px 20px; border-radius: 5px; font-size: 18px; cursor: pointer;">Access Training Module</button>
      </div>
      <div id="EndPopUp" style="display:none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: #ffffff; border: 2px solid #ff0000; padding: 20px; z-index: 9999; text-align: center; box-shadow: 0px 0px 10px 2px rgba(0,0,0,0.5);">
        <h2>This is the end of the task, please click on the button below to be redirected to the post-study questionnaire.</h2>
        <button onclick="location.href='https://descil.eu.qualtrics.com/jfe/form/SV_3f1IDhOmWi0gmpw?PROLIFIC_PID=${prolific_id}';" style="background-color: #ff0000; color: #ffffff; border: none; padding: 10px 20px; border-radius: 5px; font-size: 18px; cursor: pointer;">Finish task</button>
      </div>
      <script>
        const category = ${category};
        const bgtask_after_training = ${training_done};
  
        // 2 min
        if (category === 0 && bgtask_after_training === 0) {
            setTimeout(() => {
              document.getElementById("KnowledgePopUp").style.display = "block";
              document.getElementById("popup-overlay").style.display = "block";
            }, 10000);
            // display button on knowledge module after 4min (2min + 2min)
            setTimeout(function() {
            document.getElementById("popupBtn").style.display = "block";
            }, 240000);
        }
        
        // 5 min
        if (category == 1 && bgtask_after_training === 0) {
          setTimeout(() => {
              document.getElementById("TrainingPopUp").style.display = "block";
              document.getElementById("popup-overlay").style.display = "block";
          }, 300000);
        }
      
      /* This variable represents time at which the bgtask should end. If the user
      is doing this task after doing the training module, only 1 min left. Else, we
      compute 10 min (if the case of category 2 users) */
      var end_time;
      var figma_link;
      if (bgtask_after_training === 0) {
        end_time = 900000;
        figma_link = "https://www.figma.com/embed?embed_host=share&url=https%3A%2F%2Fwww.figma.com%2Fproto%2FiQ1dxn6XosIPUm2xJglJxD%2FAnti-phishing-Gmail-Mockup%3Fnode-id%3D912-881%26scaling%3Dmin-zoom%26page-id%3D0%253A1%26starting-point-node-id%3D0%253A2"
      } else {
        end_time = 60000;
        figma_link = "https://www.figma.com/embed?embed_host=share&url=https%3A%2F%2Fwww.figma.com%2Fproto%2FiQ1dxn6XosIPUm2xJglJxD%2FAnti-phishing-Gmail-Mockup%3Fnode-id%3D0-2%26scaling%3Dmin-zoom%26page-id%3D0%253A1%26starting-point-node-id%3D0%253A2"
      }
      document.getElementById("figmaFrame").setAttribute("src", figma_link);

      setTimeout(function() {
        document.getElementById("EndPopUp").style.display = "block";
        document.getElementById("popup-overlay").style.display = "block";
      }, end_time);


      function hideKnowledgePopUp() {
          document.getElementById("KnowledgePopUp").style.display = "none";
          document.getElementById("popup-overlay").style.display = "none";
          document.getElementById("youtubeFrame").remove();
          // 1 min, counting only when user closed the overlay
          setTimeout(() => {
                document.getElementById("TrainingPopUp").style.display = "block";
                document.getElementById("popup-overlay").style.display = "block";
          }, 60000);
      }

      </script>
    </body>
    </html>
    `;
  reply.type('text/html').send(html);
});

// Run the server and report out to the logs
fastify.listen(
  { port: process.env.PORT, host: "0.0.0.0" },
  function (err, address) {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Your app is listening on ${address}`);
  }
);
