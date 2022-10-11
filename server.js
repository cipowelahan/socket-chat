const express = require('express')
const app = express()
const server = require('http').createServer(app)
const { Server } = require('socket.io')
const path = require('path')
const fs = require('fs')
const io = new Server(server)
const port = process.env.PORT || 3000
const { Sequelize, DataTypes, Op } = require('sequelize')

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './sqllite.sqlite3'
})

const User = sequelize.define('user', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    tableName: 'users',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['username']
        }
    ]
})
User.sync({ logging: false })
    .then(() => {
        console.log('user created successfully')
    })
    .catch((err) => {
        console.log('failed create user')
        console.log(err)
    })

const Room = sequelize.define('room', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING
    },
    type: {
        type: DataTypes.STRING
    }
}, {
    tableName: 'rooms'
})
Room.sync({ logging: false })
    .then(() => {
        console.log('room created successfully')
    })
    .catch((err) => {
        console.log('failed create room')
        console.log(err)
    })

const RoomUser = sequelize.define('roomUser', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    room_id: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    user_id: {
        type: DataTypes.BIGINT,
        allowNull: false
    }
}, {
    tableName: 'room_users'
})
RoomUser.sync({ logging: false })
    .then(() => {
        console.log('roomUser created successfully')
    })
    .catch((err) => {
        console.log('failed create roomUser')
        console.log(err)
    })

const RoomMessage = sequelize.define('roomMessage', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    room_id: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    user_id: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    type: {
        type: DataTypes.STRING,
        defaultValue: 'text'
    },
    message: {
        type: DataTypes.TEXT,
    }
}, {
    tableName: 'room_messages'
})
RoomMessage.sync({ logging: false })
    .then(() => {
        console.log('roomMessage created successfully')
    })
    .catch((err) => {
        console.log('failed create roomMessage')
        console.log(err)
    })

const RoomMessageFile = sequelize.define('roomMessageFile', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    message_id: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING
    },
    path: {
        type: DataTypes.TEXT
    },
    type: {
        type: DataTypes.STRING
    }
}, {
    tableName: 'room_message_files'
})
RoomMessageFile.sync({ logging: false })
    .then(() => {
        console.log('roomMessageFile created successfully')
    })
    .catch((err) => {
        console.log('failed create roomMessageFile')
        console.log(err)
    })

Room.hasMany(RoomUser, {
    as: 'users',
    foreignKey: 'room_id'
})
Room.hasMany(RoomMessage, {
    as: 'messages',
    foreignKey: 'room_id'
})
RoomMessage.belongsTo(User, {
    as: 'user',
    foreignKey: 'user_id'
})
RoomMessage.hasOne(RoomMessageFile, {
    as: 'file',
    foreignKey: 'message_id'
})

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', ({ res }) => {
    res.sendFile(__dirname + '/index.html')
})

const chunkSize = 10240

io.on('connection', socket => {
    console.log('new connection from ' + socket.id)
    socket.broadcast.emit('checkOnlineStatus')

    socket.on('login', async ({ username }) => {
        const checkUser = await User.findOrCreate({ where: {
            username: username
        }})
        const user = checkUser[0].toJSON()

        const rooms = await Room.findAll({
            include: {
                model: RoomUser,
                as: 'users',
                where: {
                    user_id: user.id
                }
            }
        })

        for (const room of rooms) {
            socket.join(`room:${room.id}`)
        }

        io.to(socket.id).emit('login', user)
        io.emit('getUsers')
    })

    socket.on('getUsers', async ({ user_id }) => {
        const users = await User.findAll({
            where: {
                id: {
                    [Op.ne]: user_id
                }
            }
        })

        io.to(socket.id).emit('users', users)
        socket.broadcast.emit('checkOnlineStatus')
    })

    socket.on('getMessages', async ({ userId, otherId }) => {
        let selectedRoomId = null

        const roomOther = await Room.findAll({
            include: {
                model: RoomUser,
                as: 'users',
                where: {
                    user_id: otherId
                }
            }
        })

        let room = null
        if (roomOther.length !== 0) {
            const roomOtherIds = roomOther.map(m => m.id)
            room = await Room.findOne({
                include: {
                    model: RoomUser,
                    as: 'users',
                    where: {
                        user_id: userId
                    }
                },
                where: {
                    id: {
                        [Op.in]: roomOtherIds
                    }
                }
            })

        }

        if (room === null) {
            const newRoom = await Room.create({
                name: 'private room',
                type: 'private'
            })

            selectedRoomId = newRoom.id
            for (const id of [userId, otherId]) {
                await RoomUser.create({
                    room_id: selectedRoomId,
                    user_id: id
                })
            }
            
        } else {
            selectedRoomId = room.id
        }
        
        socket.join(`room:${selectedRoomId}`)

        const messages = await RoomMessage.findAll({
            include: [
                {
                    model: User,
                    as: 'user'
                },
                {
                    model: RoomMessageFile,
                    as: 'file'
                }
            ],
            where: {
                room_id: selectedRoomId
            }
        })

        io.to(socket.id).emit('getMessages', { room_id: selectedRoomId, messages })

    })

    socket.on('sendMessage', async ({ room_id, user_id, message }) => {
        await RoomMessage.create({ room_id, user_id, message })

        const messages = await RoomMessage.findAll({
            include: [
                {
                    model: User,
                    as: 'user'
                },
                {
                    model: RoomMessageFile,
                    as: 'file'
                }
            ],
            where: {
                room_id: room_id
            }
        })

        const user = await User.findOne({
            where: {
                id: user_id
            }
        })

        const notifMessage = message.replace(/<br\s*[\/]?>/g, ' ')
        const notif = {
            user_id,
            head: user.username,
            body: notifMessage.substring(0, 15) + (notifMessage.length > 15 ? '...' : '')
        }

        io.to(`room:${room_id}`).emit('getMessages', { room_id: room_id, messages })
        io.to(`room:${room_id}`).emit('notif', notif)

        const users = await RoomUser.findAll({
            where: {
                room_id: room_id,
                user_id: {
                    [Op.ne]: user_id
                }
            }
        })

        for (const userjoin of users) {
            socket.broadcast.emit('joinRoom', {
                room_id,
                user_id: userjoin.user_id,
                notif
            })
        }

    })

    socket.on('joinRoom', ({ room_id, notif }) => {
        if(!socket.rooms.has(`room:${room_id}`)) {
            socket.join(`room:${room_id}`)
            io.to(`room:${room_id}`).emit('notif', notif)
        }
    })

    socket.on('updateOnlineStatus', (data) => {
        io.emit('updateOnlineStatus', data)
    })

    socket.on('file:create', ({ room_id, user_id, indexFile, name, type, totalSize }) => {
        const path = `${new Date().getTime()}-${name.split(' ').join('_')}`
        fs.writeFile(`public/${path}`, '', (err) => {
            const data = {
                room_id,
                user_id,
                indexFile,
                name,
                path,
                type,
                sizeWrote: 0,
                startWrote: 0,
                endWrote: chunkSize,
                totalSize,
                errMessage: null
            }

            if (!err) {
                io.to(socket.id).emit('file:resume', data)
                io.to(socket.id).emit('file:process', data)
            } else {
                data.errMessage = err
                io.to(socket.id).emit('file:error', data)
            }
        })


    })

    socket.on('file:resume', (data) => {
        const { buff, ...opts } = data
        const { path, startWrote, endWrote, totalSize } = opts

        if (startWrote < totalSize) {
            fs.appendFile(`public/${path}`, buff, (err) => {
                if (!err) {
                    const appendByte = endWrote + chunkSize
                    const endByte = appendByte >= totalSize ? totalSize : appendByte

                    const newData = {
                        ...opts,
                        sizeWrote: endWrote,
                        startWrote: endWrote,
                        endWrote: endByte
                    }

                    io.to(socket.id).emit('file:resume', newData)
                    io.to(socket.id).emit('file:process', newData)
                } else {
                    io.to(socket.id).emit('file:error', {
                        ...opts,
                        errMessage: err
                    })
                }
            })
        } else {
            io.to(socket.id).emit('file:finish', opts)
        }

    })

    socket.on('file:finish', async ({ room_id, user_id, name, type, path }) => {
        const message = await RoomMessage.create({
            room_id,
            user_id,
            type: 'file',
        })

        await RoomMessageFile.create({
            message_id: message.id,
            name,
            path,
            type
        })

        const messages = await RoomMessage.findAll({
            include: [
                {
                    model: User,
                    as: 'user'
                },
                {
                    model: RoomMessageFile,
                    as: 'file'
                }
            ],
            where: {
                room_id: room_id
            }
        })

        const user = await User.findOne({
            where: {
                id: user_id
            }
        })

        const notif = {
            user_id,
            head: user.username,
            body: "new file"
        }

        io.to(`room:${room_id}`).emit('getMessages', { room_id: room_id, messages })
        io.to(`room:${room_id}`).emit('notif', notif)

        const users = await RoomUser.findAll({
            where: {
                room_id: room_id,
                user_id: {
                    [Op.ne]: user_id
                }
            }
        })

        for (const userjoin of users) {
            socket.broadcast.emit('joinRoom', {
                room_id,
                user_id: userjoin.user_id,
                notif
            })
        }
    })

    socket.on('disconnect', () => { 
        console.log(socket.id + ' disconnected')
        socket.broadcast.emit('getUsers')
    })

})

server.listen(port, '0.0.0.0', () => {
    console.log(`server listen on port ${port}`)
})