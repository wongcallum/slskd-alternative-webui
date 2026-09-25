import { Button, Flex, Text } from '@radix-ui/themes'

import { useSoulseekGate } from '../soulseek/soulseek'
import { disabledProps } from '../ui/controls'
import { JoinRoomDialog } from './JoinRoomDialog'

export function ChatEmpty() {
  const gate = useSoulseekGate()
  return (
    <Flex direction="column" align="start" gap="3" p="5">
      <Text color="gray">Join a room to chat.</Text>
      <JoinRoomDialog gate={gate}>
        <Button {...disabledProps(gate !== undefined)}>Join a room</Button>
      </JoinRoomDialog>
    </Flex>
  )
}
