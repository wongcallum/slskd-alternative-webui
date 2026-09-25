import { Button, Flex, Text } from '@radix-ui/themes'

import { useSoulseekGate } from '../soulseek/soulseek'
import { disabledProps } from '../ui/controls'
import { JoinRoomDialog } from './JoinRoomDialog'
import { MessageUserField } from './MessageUserField'

export function ChatEmpty() {
  const gate = useSoulseekGate()
  return (
    <Flex direction="column" align="start" gap="3" p="5">
      <Text color="gray">Join a room or message someone.</Text>
      <Flex gap="3" align="center">
        <JoinRoomDialog gate={gate}>
          <Button {...disabledProps(gate !== undefined)}>Join a room</Button>
        </JoinRoomDialog>
        <MessageUserField size="2" style={{ width: 240 }} />
      </Flex>
    </Flex>
  )
}
