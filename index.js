const pool = require('./db')
const express = require('express')
const http = require('http');

const PORT = 6534
const app = express()



const WebSocket = require('ws');
const server = http.createServer(app)
const wss = new WebSocket.Server({server})

app.use(express.json())


//UPGRADE FROM HTTP 1 TO WEBSOCKETS
// app.on('upgrade', (request, socket, head) => {
//     wss.handleUpgrade(request, socket, head, socket => {
//       wss.emit('connection', socket, request);
//     });
//   });

server.listen(PORT, () => console.log("ws started"))


//escapes all ' characters with '' so that it can be used in postgre DB
function escapeApostrophes(string) {
    return string.replace(/'/g, "''")
}

//when user wants to update their personal info, this update is reflected on the DB system.
async function updateUserInfo(updatedUserData) {

    const escapedUpdatedUserInfo = {...updatedUserData, 
                        firstname: escapeApostrophes(updatedUserData.firstname), 
                        surname: escapeApostrophes(updatedUserData.surname),
                        email: escapeApostrophes(updatedUserData.email)
                            }

    const updated_result = await pool.query(`UPDATE users SET firstname = '${escapedUpdatedUserInfo.firstname}', 
                        surname = '${escapedUpdatedUserInfo.surname}', email = '${escapedUpdatedUserInfo.email}' WHERE id = ${escapedUpdatedUserInfo.id}`)
    return updated_result
}

 async function getContacts(user_id) {

    const contacts = await pool.query(`select * from contacts c

    inner join users u on (u.id = c.contact_id)
    
    where c.user_id = ${user_id};`)

    //sometimes the user_id is listed in the contact_id column instead of user_id column, and so this is used instead.
    if (contacts.rowCount === 0) {
       
        //first we need a join where the user_id (the primary user) is found the contact_id column
        const contacts = (await pool.query(`select * from contacts c inner join users u on (u.id = c.contact_id) where c.contact_id = ${user_id};`))['rows']        

        //now get the contacts of the primary user (the client who has logged in)
        const modifiedContacts_cids = contacts.map(contact => contact.user_id).toString()
        const users = (await pool.query(`select * from users where id in (${modifiedContacts_cids})`))['rows']

        //now modify the array that is sent to client, where the user_id, contact_id, firstname, surname are altered.
        const modifiedContacts = contacts.map((contact, index) => {return {...contact, user_id: contact.contact_id, contact_id: contact.user_id, firstname: users[index].firstname, surname: users[index].surname, email: users[index].email, profile_img: users[index].profile_img}})
        console.log(modifiedContacts)
        return modifiedContacts
    }

    return contacts['rows']
}

async function fetchUserInfo(user_id) {
    const user = await pool.query(`select * from users where id = ${user_id}`)
    return user['rows']
}

//used to broadcast message to all clients connected to the websocket server
let clients = []

wss.on('connection', ws => {

    ws.on('message', async data => {

        //the client will always send data that is an object
        const parsedObject = JSON.parse(data)
        console.log('parsed object is: ')
        console.log(parsedObject)


        //this is used when a client wants their info updated

        if ('updatedUserData' in parsedObject) {
            // console.loh(parsedObject.updateUserInfo)
            const result = await updateUserInfo(parsedObject.updatedUserData)
            ws.close(1000, 'user info has been updated')
        }
        //this is used for setting page of the chat app

        if ('only_user_id' in parsedObject ) {
            const userInfo = await fetchUserInfo(parsedObject.only_user_id)
            ws.send(JSON.stringify(userInfo))
            ws.close(1000, 'user info sent to client')
        }



        //checks for user_id and contact_id, and then will send chat history to the client, and add client to array
        if ('user_id' in parsedObject && 'contact_id' in parsedObject && Object.keys(parsedObject).length === 2){

            clients.push(ws) //each client is a "ws"

            const chat = await pool.query(`select * from chats where (user_id = ${parsedObject.user_id} AND contact_id = ${parsedObject.contact_id}) OR (user_id = ${parsedObject.contact_id} AND contact_id = ${parsedObject.user_id})`)
            ws.send(JSON.stringify(chat['rows']))

        }

        //checks for whether we should return the contacts
        if ('contacts_of_user_id' in parsedObject) {
            const user_id = parsedObject.contacts_of_user_id
            const contacts = await getContacts(user_id)

            ws.send(JSON.stringify({contacts}))
            ws.close(1000 ,'contacts sent')
        }

        //checks for if the client has submitted a message
        if ('user_id' in parsedObject && 'contact_id' in parsedObject && 'sender_id' in parsedObject && 'userTypedMsg' in parsedObject){

            //we want to insert the new messaage into the dataase
            const message = escapeApostrophes(parsedObject.userTypedMsg) //without escaping we get DB error
            const inserted = await pool.query(`INSERT INTO chats (id,user_id, contact_id, sender_id, message, created_at) 
                                                VALUES (DEFAULT, ${parsedObject.user_id}, ${parsedObject.contact_id}, ${parsedObject.sender_id}, '${message}', NOW() )`)

            // now we want to send the chat history (includes new message) to the client
            const chat = await pool.query(`select * from chats where (user_id = ${parsedObject.user_id} AND contact_id = ${parsedObject.contact_id}) OR (user_id = ${parsedObject.contact_id} AND contact_id = ${parsedObject.user_id})`)
            console.log(`num of client = ${clients.length}`)
            clients.filter(client => client.send(JSON.stringify(chat['rows'])))
        }

        })
})
